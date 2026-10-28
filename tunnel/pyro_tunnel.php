<?php
/**
 * PyroStudio HTTP Tunnel (PyroTunnel v1)
 * High-performance binary HTTP tunnel for MariaDB & MySQL.
 *
 * Protocol: PyroTunnel Binary v1 (Magic: "PYRO" / 0x5059524F)
 * License: MIT - PyroStudio Project
 *
 * Security (fails closed; full details in SECURITY.md):
 * - A token is required (PYRO_TUNNEL_TOKEN or $tunnelToken, >= 16 chars).
 *   To rotate it: generate a new one ("Generate token" in PyroStudio or
 *   php -r "echo bin2hex(random_bytes(32)), PHP_EOL;"), set it here and save
 *   it in the connection. There is no recovery; the old one stops working.
 * - DB host allowlist (PYRO_TUNNEL_ALLOWED_DB_HOSTS or $allowedDbHosts):
 *   exact host, '*.domain' (subdomains only), CIDR ('10.0.0.0/8',
 *   'fd00::/8') or '*'. Empty = localhost only. Invalid entries are ignored
 *   and logged, never treated as '*'.
 * - Names are resolved once and EVERY resolved IP is checked; mysqli then
 *   connects to the validated IP (no DNS rebinding). 169.254.0.0/16,
 *   0.0.0.0/8, '::', fe80::/10 and multicast are always blocked.
 * - Threat model of '*': anyone holding the token can use this server as a
 *   bridge (SSRF) to every host it can reach, including its internal
 *   network. Prefer narrow entries, HTTPS and a long random token.
 */

declare(strict_types=1);

const PYRO_TUNNEL_MAGIC = 0x5059524F; // "PYRO"
const PYRO_TUNNEL_VERSION = 1;
const PYRO_MAX_REQUEST_BYTES = 8388608; // 8 MiB
const PYRO_MAX_SINGLE_QUERY_BYTES = 4194304; // 4 MiB
const PYRO_MAX_QUERIES_PER_BATCH = 100;
const PYRO_MAX_ROWS_PER_RESULT = 20000;

const PYRO_MIN_TOKEN_LENGTH = 16;

// Browser diagnostic page on GET requests. Disabled by default; it can also be
// enabled with the environment variable PYRO_TUNNEL_DIAGNOSTIC_PAGE=1.
// It never shows server details, and the connection test requires the token.
$allowDiagnosticPage = false;

// Database hosts this tunnel may connect to.
// Empty [] (default) = only localhost, 127.0.0.1 and ::1.
// Any other host must be listed explicitly here or in PYRO_TUNNEL_ALLOWED_DB_HOSTS
// (comma separated). An explicit list replaces the default, so include
// 'localhost' too if you still need it. Entry forms:
//   'db.example.com'  exact host (case insensitive)
//   '*.example.com'   any subdomain (NOT example.com itself; list it apart)
//   '10.0.0.0/8'      IPv4/IPv6 CIDR ('fd00::/8'); a plain IP is a /32 or /128
//   '*'               any host (HIGHEST RISK: see SECURITY.md)
// Names are resolved and EVERY resolved IP is checked; the tunnel then connects
// to that IP. 169.254.0.0/16, 0.0.0.0/8, fe80::/10 and multicast are always
// blocked. Invalid entries are ignored and logged with error_log().
// Example: ['localhost', '127.0.0.1', '10.0.0.0/8', '*.db.internal']
$allowedDbHosts = [];

// TLS between this tunnel and the database (PYRO_TUNNEL_DB_TLS overrides it):
//   'off'       (default, compatible) plain text; responses for non-loopback
//               targets carry the header "X-Pyro-Db-Tls: off" so PyroStudio
//               can warn that this hop is not encrypted
//   'preferred' try TLS, fall back to plain text if it fails
//   'required'  TLS or the request fails with error 217
// Any other value is logged and treated as 'required'.
$dbTlsMode = 'off';

// Optional CA file (PEM) to verify the database certificate
// (PYRO_TUNNEL_DB_TLS_CA overrides it). WITHOUT a CA the connection is
// encrypted but the server identity is NOT verified. The tunnel connects to
// the validated IP (DNS rebinding protection), so mysqlnd checks the
// certificate against that IP: it must list the IP in its subjectAltName.
$dbTlsCa = '';

// REQUIRED: secret token for Bearer authentication (minimum 16 characters).
// Prefer the environment variable PYRO_TUNNEL_TOKEN. Without a token the tunnel
// rejects every request (fail closed) instead of acting as an open proxy.
// Generate one with: php -r "echo bin2hex(random_bytes(32)), PHP_EOL;"
$tunnelToken = '';

error_reporting(0);
ini_set('display_errors', '0');
header_remove('X-Powered-By');
set_time_limit(120);

// Polyfill for PHP 7.x compatibility
if (!function_exists('str_starts_with')) {
    function str_starts_with(string $haystack, string $needle): bool
    {
        return $needle === '' || strncmp($haystack, $needle, strlen($needle)) === 0;
    }
}

// Global shutdown handler to intercept fatal errors and return structured binary packets
register_shutdown_function(function () {
    $error = error_get_last();
    if ($error !== null && in_array($error['type'], [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR, E_USER_ERROR], true)) {
        if (ob_get_level() > 0) {
            @ob_clean();
        }
        if (!headers_sent()) {
            http_response_code(200);
            header('Content-Type: application/octet-stream');
            header('Cache-Control: no-store, no-cache, must-revalidate');
        }
        echo pyro_pack_u32(PYRO_TUNNEL_MAGIC)
            . pyro_pack_u16(PYRO_TUNNEL_VERSION)
            . pyro_pack_u32(299);
        echo pyro_pack_block('PHP Fatal: ' . $error['message'] . ' on line ' . $error['line']);
    }
});

function pyro_pack_u16(int $num): string
{
    return pack('n', $num & 0xFFFF);
}

function pyro_pack_u32(int $num): string
{
    return pack('N', $num & 0xFFFFFFFF);
}

/**
 * Packs an unsigned 64-bit integer in big-endian order.
 * Handles both 64-bit and 32-bit PHP builds safely.
 */
function pyro_pack_u64($num): string
{
    if (is_string($num)) {
        if (PHP_INT_SIZE >= 8) {
            $intVal = (int) $num;
            return pack('J', max(0, $intVal));
        }
        $low = (int) $num;
        return pack('NN', 0, max(0, $low));
    }
    $val = max(0, (int) $num);
    if (PHP_INT_SIZE >= 8) {
        return pack('J', $val);
    }
    return pack('NN', 0, $val);
}

function pyro_pack_block(string $val): string
{
    $len = strlen($val);
    if ($len < 254) {
        return chr($len) . $val;
    }
    return "\xFE" . pyro_pack_u32($len) . $val;
}

function pyro_send_header(int $errno): void
{
    echo pyro_pack_u32(PYRO_TUNNEL_MAGIC)
        . pyro_pack_u16(PYRO_TUNNEL_VERSION)
        . pyro_pack_u32($errno);
}

function pyro_finish_response(?mysqli $conn = null): void
{
    if ($conn instanceof mysqli) {
        @$conn->close();
    }

    $payload = '';
    if (ob_get_level() > 0) {
        $buf = ob_get_clean();
        if (is_string($buf)) {
            $payload = $buf;
        }
    }

    $zlibConfig = ini_get('zlib.output_compression');
    $isZlibActive = (
        $zlibConfig !== false &&
        $zlibConfig !== '' &&
        strtolower((string) $zlibConfig) !== 'off' &&
        $zlibConfig !== '0'
    );

    if (!$isZlibActive && !headers_sent()) {
        $acceptEncoding = $_SERVER['HTTP_ACCEPT_ENCODING'] ?? '';
        if (
            strlen($payload) >= 1024 &&
            stripos($acceptEncoding, 'gzip') !== false &&
            function_exists('gzencode')
        ) {
            $compressed = @gzencode($payload, 1);
            if ($compressed !== false) {
                header('Content-Encoding: gzip');
                header('Vary: Accept-Encoding');
                $payload = $compressed;
            }
        }
        header('Content-Length: ' . strlen($payload));
    }

    echo $payload;
    exit;
}

function pyro_reject_request(int $errorCode, string $message, int $httpStatus): void
{
    if (ob_get_level() > 0) {
        @ob_clean();
    } else {
        ob_start();
    }
    http_response_code($httpStatus);
    header('Content-Type: application/octet-stream');
    header('Cache-Control: no-store, no-cache, must-revalidate');
    pyro_send_header($errorCode);
    echo pyro_pack_block($message);
    pyro_finish_response();
}

/**
 * Returns the configured tunnel token, or '' when it is missing or too short.
 */
function pyro_required_token(): string
{
    global $tunnelToken;
    $token = getenv('PYRO_TUNNEL_TOKEN');
    if ($token === false || trim($token) === '') {
        $token = (string) $tunnelToken;
    }
    $token = trim($token);
    return strlen($token) >= PYRO_MIN_TOKEN_LENGTH ? $token : '';
}

/**
 * Returns the token sent by the client. Apache with PHP as CGI/FastCGI often
 * strips the Authorization header, so X-Pyro-Token is accepted as well.
 */
function pyro_presented_token(): string
{
    $authHeader = $_SERVER['HTTP_AUTHORIZATION']
        ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION']
        ?? '';
    if ($authHeader === '' && function_exists('getallheaders')) {
        foreach ((array) getallheaders() as $name => $value) {
            if (strcasecmp((string) $name, 'Authorization') === 0) {
                $authHeader = $value;
                break;
            }
        }
    }
    if (is_string($authHeader) && strncasecmp($authHeader, 'Bearer ', 7) === 0) {
        $token = trim(substr($authHeader, 7));
        if ($token !== '') {
            return $token;
        }
    }
    $custom = $_SERVER['HTTP_X_PYRO_TOKEN'] ?? '';
    return is_string($custom) ? trim($custom) : '';
}

function pyro_diagnostic_page_enabled(): bool
{
    global $allowDiagnosticPage;
    return $allowDiagnosticPage === true || getenv('PYRO_TUNNEL_DIAGNOSTIC_PAGE') === '1';
}

// -----------------------------------------------------------------------------
// Database host allowlist
// -----------------------------------------------------------------------------

/**
 * Ranges that are never reachable through the tunnel, whatever the allowlist
 * says: link-local (includes cloud metadata 169.254.169.254), other cloud
 * metadata endpoints (Alibaba, Oracle, AWS IPv6), "this network", the
 * unspecified address and multicast. IPv4 addresses embedded in IPv6 (see
 * pyro_embedded_ipv4()) are checked against the same list.
 */
const PYRO_BLOCKED_CIDRS = [
    '169.254.0.0/16',
    '100.100.100.200/32',
    '192.0.0.192/32',
    '0.0.0.0/8',
    '224.0.0.0/4',
    'fe80::/10',
    'ff00::/8',
    'fd00:ec2::254/128',
    '::/128',
];

const PYRO_DEFAULT_ALLOWED_DB_HOSTS = ['localhost', '127.0.0.1', '::1'];

/**
 * Parses an IPv4 written in any inet_aton() form (127.1, 2130706433, 0x7f.1,
 * 0177.0.0.1) into dotted decimal, or null when it is not such a number.
 */
function pyro_parse_ipv4_loose(string $host): ?string
{
    $parts = explode('.', $host);
    if (count($parts) > 4) {
        return null;
    }
    $values = [];
    foreach ($parts as $part) {
        if (preg_match('/^0x([0-9a-f]+)$/', $part, $m)) {
            $digits = ltrim($m[1], '0');
            if (strlen($digits) > 8) {
                return null;
            }
            $values[] = (int) hexdec($digits === '' ? '0' : $digits);
        } elseif (preg_match('/^0([0-7]*)$/', $part, $m)) {
            $digits = ltrim($m[1], '0');
            if (strlen($digits) > 11) {
                return null;
            }
            $values[] = (int) octdec($digits === '' ? '0' : $digits);
        } elseif (preg_match('/^[1-9][0-9]{0,9}$/', $part)) {
            $values[] = (int) $part;
        } else {
            return null;
        }
    }
    // The last part fills the remaining bytes (inet_aton semantics)
    $last = array_pop($values);
    foreach ($values as $value) {
        if ($value > 255) {
            return null;
        }
    }
    if ($last > (1 << (8 * (4 - count($values)))) - 1) {
        return null;
    }
    $num = $last;
    foreach ($values as $i => $value) {
        $num += $value << (8 * (3 - $i));
    }
    return long2ip($num);
}

/**
 * Canonical text form of an IP address (IPv4-mapped IPv6 becomes IPv4), or
 * null when the string is not an IP literal.
 */
function pyro_canonical_ip(string $host): ?string
{
    if (strpos($host, ':') !== false) {
        $packed = @inet_pton($host);
        if ($packed === false || strlen($packed) !== 16) {
            return null;
        }
        if (substr($packed, 0, 12) === str_repeat("\0", 10) . "\xff\xff") {
            return inet_ntop(substr($packed, 12));
        }
        return inet_ntop($packed);
    }
    return pyro_parse_ipv4_loose($host);
}

/**
 * Normalizes a database host: trims, lowercases, removes IPv6 brackets and a
 * trailing dot, and canonicalizes IP literals. Returns null for anything that
 * is not a plain hostname or IP (mysqli prefixes such as "p:", paths, spaces,
 * wildcards, names over 253 characters).
 */
function pyro_normalize_db_host(string $host): ?string
{
    $host = strtolower(trim($host));
    if ($host === '' || strlen($host) > 253) {
        return null;
    }
    if ($host[0] === '[' || substr($host, -1) === ']') {
        if (!preg_match('/^\[([0-9a-f:.]+)\]$/', $host, $m) || strpos($m[1], ':') === false) {
            return null;
        }
        return pyro_canonical_ip($m[1]);
    }
    if (strpos($host, ':') !== false) {
        return preg_match('/^[0-9a-f:.]+$/', $host) ? pyro_canonical_ip($host) : null;
    }
    if (substr($host, -1) === '.') {
        $host = substr($host, 0, -1);
    }
    if (!preg_match('/^[a-z0-9_-]{1,63}(\.[a-z0-9_-]{1,63})*$/', $host)) {
        return null;
    }
    $labels = explode('.', $host);
    foreach ($labels as $label) {
        if ($label[0] === '-' || substr($label, -1) === '-') {
            return null;
        }
    }
    // A numeric last label means an IP literal: it must parse as one
    if (preg_match('/^([0-9]+|0x[0-9a-f]*)$/', end($labels))) {
        return pyro_parse_ipv4_loose($host);
    }
    return $host;
}

/** Parses "ip/prefix" into [packedNetwork, prefix], or null when invalid. */
function pyro_parse_cidr(string $cidr): ?array
{
    if (!preg_match('#^([0-9a-f:.]+)/([0-9]{1,3})$#', $cidr, $m)) {
        return null;
    }
    $ip = pyro_canonical_ip($m[1]);
    if ($ip === null) {
        return null;
    }
    $packed = inet_pton($ip);
    $prefix = (int) $m[2];
    if ($m[2] !== (string) $prefix || $prefix > strlen($packed) * 8) {
        return null;
    }
    return [$packed, $prefix];
}

function pyro_ip_in_cidr(string $ip, string $network, int $prefix): bool
{
    $packed = @inet_pton($ip);
    if ($packed === false || strlen($packed) !== strlen($network)) {
        return false;
    }
    $bytes = intdiv($prefix, 8);
    if (substr($packed, 0, $bytes) !== substr($network, 0, $bytes)) {
        return false;
    }
    $bits = $prefix % 8;
    if ($bits === 0) {
        return true;
    }
    $mask = (0xff << (8 - $bits)) & 0xff;
    return (ord($packed[$bytes]) & $mask) === (ord($network[$bytes]) & $mask);
}

/**
 * Returns the IPv4 address embedded in a packed IPv6 address, or null when it
 * carries none. Covers IPv4-compatible (::/96, except :: and ::1), IPv4-mapped
 * (::ffff:0:0/96), SIIT (::ffff:0:0:0/96), NAT64 (64:ff9b::/96 and the local
 * 64:ff9b:1::/48, last 4 bytes) and 6to4 (2002::/16, bytes 2-5). Any of these
 * may be routed to the embedded IPv4, so it must pass the same checks.
 */
function pyro_embedded_ipv4(string $packed): ?string
{
    if (strlen($packed) !== 16) {
        return null;
    }
    $zero8 = str_repeat("\0", 8);
    $last4 = substr($packed, 12);
    if (substr($packed, 0, 12) === $zero8 . "\0\0\0\0") {
        return in_array($last4, ["\0\0\0\0", "\0\0\0\1"], true) ? null : inet_ntop($last4);
    }
    if (
        substr($packed, 0, 12) === $zero8 . "\0\0\xff\xff" ||
        substr($packed, 0, 12) === $zero8 . "\xff\xff\0\0" ||
        substr($packed, 0, 12) === "\x00\x64\xff\x9b" . $zero8 ||
        substr($packed, 0, 6) === "\x00\x64\xff\x9b\x00\x01"
    ) {
        return inet_ntop($last4);
    }
    if (substr($packed, 0, 2) === "\x20\x02") {
        return inet_ntop(substr($packed, 2, 4));
    }
    return null;
}

/**
 * True for addresses the tunnel must never reach (see PYRO_BLOCKED_CIDRS),
 * either directly or through an IPv4 embedded in an IPv6 address.
 */
function pyro_is_blocked_ip(string $ip): bool
{
    $candidates = [$ip];
    $packed = @inet_pton($ip);
    if ($packed !== false) {
        $embedded = pyro_embedded_ipv4($packed);
        if ($embedded !== null) {
            $candidates[] = $embedded;
        }
    }
    foreach (PYRO_BLOCKED_CIDRS as $cidr) {
        [$network, $prefix] = pyro_parse_cidr($cidr);
        foreach ($candidates as $candidate) {
            if (pyro_ip_in_cidr($candidate, $network, $prefix)) {
                return true;
            }
        }
    }
    return false;
}

/**
 * Turns the configured allowlist into rules. Entry forms: "*", "*.domain",
 * CIDR ("10.0.0.0/8", "fd00::/8"), IP or exact hostname. Invalid entries are
 * skipped and reported in the second element; they never widen the list.
 * An empty list means the default (localhost only).
 *
 * @return array{0: array<int, array<string, mixed>>, 1: array<int, string>}
 */
function pyro_parse_allowlist(array $rawEntries): array
{
    $raw = [];
    foreach ($rawEntries as $entry) {
        $entry = trim((string) $entry);
        if ($entry !== '') {
            $raw[] = $entry;
        }
    }
    if ($raw === []) {
        $raw = PYRO_DEFAULT_ALLOWED_DB_HOSTS;
    }

    $entries = [];
    $errors = [];
    foreach ($raw as $entry) {
        $lower = strtolower($entry);
        if ($lower === '*') {
            $entries[] = ['type' => 'any'];
        } elseif (str_starts_with($lower, '*.')) {
            $suffix = substr($lower, -1) === '.' ? null : pyro_normalize_db_host(substr($lower, 2));
            if ($suffix !== null && pyro_canonical_ip($suffix) === null) {
                $entries[] = ['type' => 'suffix', 'value' => '.' . $suffix];
            } else {
                $errors[] = "invalid wildcard entry '$entry'";
            }
        } elseif (strpos($lower, '/') !== false) {
            $cidr = pyro_parse_cidr($lower);
            if ($cidr !== null) {
                $entries[] = ['type' => 'cidr', 'network' => $cidr[0], 'prefix' => $cidr[1]];
            } else {
                $errors[] = "invalid CIDR entry '$entry'";
            }
        } else {
            $host = pyro_normalize_db_host($lower);
            if ($host === null) {
                $errors[] = "invalid host entry '$entry'";
            } elseif ($host !== 'localhost' && pyro_canonical_ip($host) !== null) {
                $packed = inet_pton($host);
                $entries[] = ['type' => 'cidr', 'network' => $packed, 'prefix' => strlen($packed) * 8];
            } else {
                $entries[] = ['type' => 'name', 'value' => $host];
            }
        }
    }
    return [$entries, $errors];
}

/** Reads the allowlist from PYRO_TUNNEL_ALLOWED_DB_HOSTS or $allowedDbHosts. */
function pyro_configured_allowlist(): array
{
    global $allowedDbHosts;
    $envList = getenv('PYRO_TUNNEL_ALLOWED_DB_HOSTS');
    if ($envList !== false && trim($envList) !== '') {
        $raw = explode(',', $envList);
    } elseif (!empty($allowedDbHosts) && is_array($allowedDbHosts)) {
        $raw = $allowedDbHosts;
    } else {
        $raw = [];
    }
    [$entries, $errors] = pyro_parse_allowlist($raw);
    foreach ($errors as $error) {
        error_log('PyroTunnel configuration error: ' . $error . ' in the DB host allowlist (ignored).');
    }
    return $entries;
}

/**
 * Resolves A and AAAA records. gethostbynamel() honours /etc/hosts and the
 * system resolver; dns_get_record() adds IPv6. Either may be disabled on
 * shared hosting, so both are tried and their answers merged.
 *
 * @return array<int, string>
 */
function pyro_resolve_host(string $name): array
{
    $ips = [];
    if (function_exists('gethostbynamel')) {
        $ipv4 = @gethostbynamel($name);
        if (is_array($ipv4)) {
            $ips = array_merge($ips, $ipv4);
        }
    }
    if (function_exists('dns_get_record')) {
        $records = @dns_get_record($name, DNS_A | DNS_AAAA);
        foreach (is_array($records) ? $records : [] as $record) {
            if (isset($record['ip'])) {
                $ips[] = $record['ip'];
            } elseif (isset($record['ipv6'])) {
                $ips[] = $record['ipv6'];
            }
        }
    }
    return array_values(array_unique($ips));
}

/**
 * Decides whether the tunnel may connect to $host and returns the address to
 * connect to. Names are resolved once here; the caller must connect to the
 * returned 'target' (a validated IP, or 'localhost') and never to the name, so
 * the DNS answer cannot change between the check and the connection.
 *
 * A host is allowed when its name matches an exact, "*.domain" or "*" entry,
 * or when every resolved IP falls in an IP/CIDR entry. In every case each
 * resolved IP must be outside PYRO_BLOCKED_CIDRS.
 *
 * @param callable(string): array<int, string> $resolver
 * @return array{ok: bool, errno: int, target: string, message: string}
 */
function pyro_check_db_host(string $host, bool $tokenVerified, array $entries, callable $resolver): array
{
    $deny = function (int $errno, string $message): array {
        return ['ok' => false, 'errno' => $errno, 'target' => '', 'message' => $message];
    };
    // Defense in depth: no allowlist rule, least of all "*", applies before
    // the token has been verified.
    if (!$tokenVerified) {
        return $deny(212, 'Invalid authentication token.');
    }
    $notAllowed = 'Database host is not in the tunnel allowlist.';

    $normalized = pyro_normalize_db_host($host);
    if ($normalized === null) {
        return $deny(206, $notAllowed);
    }

    $nameAllowed = false;
    foreach ($entries as $entry) {
        if (
            $entry['type'] === 'any' ||
            ($entry['type'] === 'name' && $entry['value'] === $normalized) ||
            ($entry['type'] === 'suffix' && substr($normalized, -strlen($entry['value'])) === $entry['value'])
        ) {
            $nameAllowed = true;
            break;
        }
    }

    // localhost keeps its usual meaning (Unix socket / loopback), unresolved
    if ($normalized === 'localhost') {
        return $nameAllowed
            ? ['ok' => true, 'errno' => 0, 'target' => 'localhost', 'message' => '']
            : $deny(206, $notAllowed);
    }

    $hasCidr = false;
    foreach ($entries as $entry) {
        $hasCidr = $hasCidr || $entry['type'] === 'cidr';
    }
    // Nothing could allow it: reject without querying DNS
    if (!$nameAllowed && !$hasCidr) {
        return $deny(206, $notAllowed);
    }

    if (pyro_canonical_ip($normalized) !== null) {
        $ips = [$normalized];
    } else {
        $ips = [];
        foreach ($resolver($normalized) as $resolved) {
            $resolved = strtolower(trim((string) $resolved));
            // Only strict dotted-quad or IPv6 answers are trusted
            if (!filter_var($resolved, FILTER_VALIDATE_IP)) {
                return $deny(206, $notAllowed);
            }
            $ips[] = pyro_canonical_ip($resolved);
        }
        if ($ips === []) {
            return $deny(2005, "Unknown database host '$normalized' (DNS resolution failed on the tunnel server).");
        }
    }

    $allInCidr = true;
    foreach ($ips as $ip) {
        if (pyro_is_blocked_ip($ip)) {
            return $deny(206, $notAllowed);
        }
        $inCidr = false;
        foreach ($entries as $entry) {
            if ($entry['type'] === 'cidr' && pyro_ip_in_cidr($ip, $entry['network'], $entry['prefix'])) {
                $inCidr = true;
                break;
            }
        }
        $allInCidr = $allInCidr && $inCidr;
    }
    if (!$nameAllowed && !$allInCidr) {
        return $deny(206, $notAllowed);
    }

    // Prefer IPv4: mysqli takes it without brackets on every PHP version
    $target = $ips[0];
    foreach ($ips as $ip) {
        if (strpos($ip, ':') === false) {
            $target = $ip;
            break;
        }
    }
    return ['ok' => true, 'errno' => 0, 'target' => $target, 'message' => ''];
}

// -----------------------------------------------------------------------------
// TLS between the tunnel and the database
// -----------------------------------------------------------------------------

/**
 * Parses a TLS mode ('off', 'preferred', 'required'; empty = 'off'). An
 * unknown value becomes 'required' (fails closed) and is reported.
 *
 * @return array{0: string, 1: ?string} [mode, error]
 */
function pyro_parse_db_tls_mode(string $raw): array
{
    $mode = strtolower(trim($raw));
    if ($mode === '') {
        return ['off', null];
    }
    if (in_array($mode, ['off', 'preferred', 'required'], true)) {
        return [$mode, null];
    }
    return ['required', "invalid DB TLS mode '$raw' (treated as 'required')"];
}

/** True for targets on this machine: 'localhost', 127.0.0.0/8 and ::1. */
function pyro_is_loopback_target(string $target): bool
{
    if ($target === 'localhost' || $target === '::1') {
        return true;
    }
    return strpos($target, ':') === false && pyro_ip_in_cidr($target, inet_pton('127.0.0.0'), 8);
}

/**
 * Decides how to connect: 'attempts' lists the connections to try in order
 * (true = TLS), 'verify_cert' whether the certificate is checked against
 * 'ca', 'require_cipher' whether a session without TLS must be rejected, and
 * 'warn_plaintext' whether to send "X-Pyro-Db-Tls: off".
 *
 * @return array{attempts: array<int, bool>, ca: ?string, verify_cert: bool, require_cipher: bool, warn_plaintext: bool}
 */
function pyro_db_tls_plan(string $mode, string $caPath, bool $isLoopback): array
{
    $ca = trim($caPath) === '' ? null : trim($caPath);
    if ($mode === 'off') {
        return [
            'attempts' => [false],
            'ca' => null,
            'verify_cert' => false,
            'require_cipher' => false,
            'warn_plaintext' => !$isLoopback,
        ];
    }
    return [
        'attempts' => $mode === 'required' ? [true] : [true, false],
        'ca' => $ca,
        'verify_cert' => $ca !== null,
        'require_cipher' => $mode === 'required',
        'warn_plaintext' => false,
    ];
}

/** Reads the TLS mode and CA from the environment or the variables above. */
function pyro_configured_db_tls(): array
{
    global $dbTlsMode, $dbTlsCa;
    $rawMode = getenv('PYRO_TUNNEL_DB_TLS');
    if ($rawMode === false || trim($rawMode) === '') {
        $rawMode = (string) $dbTlsMode;
    }
    [$mode, $error] = pyro_parse_db_tls_mode($rawMode);
    if ($error !== null) {
        error_log('PyroTunnel configuration error: ' . $error . '.');
    }
    $ca = getenv('PYRO_TUNNEL_DB_TLS_CA');
    if ($ca === false || trim($ca) === '') {
        $ca = (string) $dbTlsCa;
    }
    return [$mode, $ca];
}

/** Opens the mysqli connection following pyro_db_tls_plan(). */
function pyro_db_connect(array $plan, string $host, string $login, string $password, int $port): mysqli
{
    $conn = null;
    foreach ($plan['attempts'] as $useTls) {
        $conn = mysqli_init();
        if ($conn === false) {
            pyro_send_header(204);
            echo pyro_pack_block('Failed to initialize mysqli instance.');
            pyro_finish_response();
        }
        $conn->options(MYSQLI_OPT_CONNECT_TIMEOUT, 10);
        $flags = 0;
        if ($useTls) {
            $conn->ssl_set(null, null, $plan['ca'], null, null);
            $flags = MYSQLI_CLIENT_SSL;
            if ($plan['verify_cert']) {
                $conn->options(MYSQLI_OPT_SSL_VERIFY_SERVER_CERT, true);
            } else {
                $flags |= MYSQLI_CLIENT_SSL_DONT_VERIFY_SERVER_CERT;
            }
        }
        if (@$conn->real_connect($host, $login, $password, '', $port, null, $flags) && !$conn->connect_errno) {
            if (!$useTls && !pyro_is_loopback_target($host)) {
                // Fallback of 'preferred': this hop travels in plain text
                header('X-Pyro-Db-Tls: off');
            }
            return $conn;
        }
        // Wrong credentials will not improve without TLS: report them now
        if ($conn->connect_errno === 1045) {
            break;
        }
    }

    if ($plan['require_cipher']) {
        pyro_send_header(217);
        echo pyro_pack_block('The database server does not offer TLS (or its certificate was rejected): '
            . ($conn->connect_error ?: 'TLS connection failed.'));
        pyro_finish_response($conn);
    }
    pyro_send_header($conn->connect_errno ?: 2002);
    echo pyro_pack_block($conn->connect_error ?: 'Unable to connect to MySQL/MariaDB server.');
    pyro_finish_response($conn);
}

function pyro_emit_connection_info(mysqli $conn): void
{
    echo pyro_pack_block($conn->host_info ?? 'localhost')
        . pyro_pack_block((string) $conn->protocol_version)
        . pyro_pack_block($conn->server_info ?? 'MariaDB/MySQL');
}

function pyro_emit_result_header(
    int $errno,
    $affectedRows,
    $insertId,
    int $numFields,
    int $numRows
): void {
    echo pyro_pack_u32($errno)
        . pyro_pack_u64($affectedRows)
        . pyro_pack_u64($insertId)
        . pyro_pack_u32($numFields)
        . pyro_pack_u32($numRows);
}

function pyro_emit_fields_metadata(mysqli_result $res, int $numFields): void
{
    $buffer = '';
    for ($i = 0; $i < $numFields; $i++) {
        $finfo = $res->fetch_field_direct($i);
        $buffer .= pyro_pack_block($finfo->name ?? '')
            . pyro_pack_block($finfo->table ?? '')
            . pyro_pack_u16((int) ($finfo->type ?? 253))
            . pyro_pack_u16((int) ($finfo->flags ?? 0))
            . pyro_pack_u32((int) ($finfo->length ?? 0));
    }
    echo $buffer;
}

function pyro_emit_rows(mysqli_result $res, int $numFields, int $numRows): void
{
    $chunk = '';
    $chunkLimit = 65536; // Flush every 64 KiB for low memory overhead

    for ($i = 0; $i < $numRows; $i++) {
        $row = $res->fetch_row();
        if ($row === null) {
            for ($j = 0; $j < $numFields; $j++) {
                $chunk .= "\xFF";
            }
            continue;
        }
        for ($j = 0; $j < $numFields; $j++) {
            $cell = $row[$j];
            if ($cell === null) {
                $chunk .= "\xFF";
            } else {
                $chunk .= pyro_pack_block((string) $cell);
            }
        }
        if (strlen($chunk) >= $chunkLimit) {
            echo $chunk;
            $chunk = '';
        }
    }

    if ($chunk !== '') {
        echo $chunk;
    }
}

// Included as a library (unit tests): define the functions only.
if (defined('PYRO_TUNNEL_LIB')) {
    return;
}

// -----------------------------------------------------------------------------
// Request Handling
// -----------------------------------------------------------------------------

$isPostRequest = ($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'POST';
$hasTunnelParams = isset($_POST['actn'], $_POST['host'], $_POST['port'], $_POST['login']);
$requiredToken = pyro_required_token();

// Fail closed: without a configured token the tunnel refuses every request.
if ($requiredToken === '') {
    $message = 'PyroTunnel is not configured: set the PYRO_TUNNEL_TOKEN environment variable '
        . '(or $tunnelToken in pyro_tunnel.php) to a secret of at least '
        . PYRO_MIN_TOKEN_LENGTH . ' characters, and use the same token in PyroStudio.';
    if (!$isPostRequest) {
        http_response_code(503);
        header('Content-Type: text/plain; charset=utf-8');
        header('Cache-Control: no-store');
        echo $message;
        exit;
    }
    pyro_reject_request(215, $message, 503);
}

if (!$isPostRequest || !$hasTunnelParams) {
    if (!pyro_diagnostic_page_enabled()) {
        pyro_reject_request(202, 'Invalid tunnel parameters.', 400);
    }
} else {
    ob_start();
    header('Content-Type: application/octet-stream');
    header('Cache-Control: no-store, no-cache, must-revalidate');

    if (
        isset($_SERVER['HTTP_X_REQUEST_ID']) &&
        is_string($_SERVER['HTTP_X_REQUEST_ID']) &&
        preg_match('/^[A-Za-z0-9._-]{1,64}$/', $_SERVER['HTTP_X_REQUEST_ID'])
    ) {
        header('X-Request-Id: ' . $_SERVER['HTTP_X_REQUEST_ID']);
    }

    $contentLength = isset($_SERVER['CONTENT_LENGTH']) ? (int) $_SERVER['CONTENT_LENGTH'] : 0;
    if ($contentLength > PYRO_MAX_REQUEST_BYTES) {
        pyro_reject_request(205, 'Request payload exceeds 8 MiB.', 413);
    }

    if (
        !is_string($_POST['actn']) ||
        !is_string($_POST['host']) ||
        !is_string($_POST['port']) ||
        !is_string($_POST['login'])
    ) {
        pyro_reject_request(213, 'Invalid request parameter types.', 400);
    }

    if (
        (isset($_POST['password']) && !is_string($_POST['password'])) ||
        (isset($_POST['db']) && !is_string($_POST['db'])) ||
        (isset($_POST['encodeBase64']) && !is_string($_POST['encodeBase64']))
    ) {
        pyro_reject_request(213, 'Invalid request parameter types.', 400);
    }

    $action = $_POST['actn'];
    $host = trim($_POST['host']);
    $portStr = trim($_POST['port']);
    $login = $_POST['login'];
    $password = $_POST['password'] ?? '';
    $database = $_POST['db'] ?? '';
    $encodeBase64 = ($_POST['encodeBase64'] ?? '0') === '1';

    // If host was passed with port syntax (e.g. "127.0.0.1:3306"), separate them cleanly.
    // Bare IPv6 addresses (several ':') and "[::1]" are left untouched.
    // Only a numeric suffix is a port, so prefixes like "p:host" reach the allowlist intact.
    if (substr_count($host, ':') === 1 && !str_starts_with($host, '[') && preg_match('/:[0-9]+$/', $host)) {
        $parts = explode(':', $host, 2);
        $host = $parts[0];
        if (empty($portStr) || $portStr === '3306') {
            $portStr = $parts[1];
        }
    }

    if (strlen($host) > 253 || strlen($login) > 256 || strlen($database) > 256) {
        pyro_reject_request(214, 'Request parameter exceeds its length limit.', 400);
    }

    // Mandatory Bearer token validation (PYRO_TUNNEL_TOKEN env var or $tunnelToken)
    $presentedToken = pyro_presented_token();
    if (!hash_equals($requiredToken, $presentedToken)) {
        pyro_reject_request(212, 'Invalid authentication token.', 401);
    }

    // Validates the resolved destination; $host becomes the checked address so
    // mysqli never resolves the name again (DNS rebinding).
    $hostCheck = pyro_check_db_host($host, true, pyro_configured_allowlist(), 'pyro_resolve_host');
    if (!$hostCheck['ok']) {
        pyro_reject_request($hostCheck['errno'], $hostCheck['message'], $hostCheck['errno'] === 206 ? 403 : 200);
    }
    $host = $hostCheck['target'];

    if (!preg_match('/^[0-9]{1,5}$/', $portStr)) {
        pyro_reject_request(207, 'Invalid database port.', 400);
    }
    $port = (int) $portStr;
    if ($port < 1 || $port > 65535) {
        pyro_reject_request(207, 'Invalid database port.', 400);
    }

    if ($action !== 'C' && $action !== 'Q' && $action !== 'K') {
        pyro_reject_request(208, 'Unsupported tunnel operation.', 400);
    }

    if ($action === 'K') {
        if (
            !isset($_POST['qid']) ||
            !is_string($_POST['qid']) ||
            !preg_match('/^[A-Za-z0-9._-]{1,64}$/', $_POST['qid'])
        ) {
            pyro_reject_request(202, 'Invalid query cancellation ID.', 400);
        }
    }

    $queries = [];
    if ($action === 'Q') {
        if (
            !isset($_POST['q']) ||
            !is_array($_POST['q']) ||
            count($_POST['q']) === 0 ||
            count($_POST['q']) > PYRO_MAX_QUERIES_PER_BATCH
        ) {
            pyro_reject_request(209, 'Invalid query list.', 400);
        }

        $totalQueryBytes = 0;
        foreach ($_POST['q'] as $rawQuery) {
            if (!is_string($rawQuery)) {
                pyro_reject_request(213, 'Invalid query parameter types.', 400);
            }
            $rawLen = strlen($rawQuery);
            if ($rawLen > PYRO_MAX_SINGLE_QUERY_BYTES) {
                pyro_reject_request(210, 'A single query exceeds 4 MiB.', 413);
            }
            $totalQueryBytes += $rawLen;
            if ($totalQueryBytes > PYRO_MAX_REQUEST_BYTES) {
                pyro_reject_request(205, 'Aggregate query payload exceeds 8 MiB.', 413);
            }

            if ($encodeBase64) {
                $decoded = base64_decode($rawQuery, true);
                if ($decoded === false) {
                    pyro_reject_request(215, 'Invalid Base64 query payload.', 400);
                }
                $queries[] = $decoded;
            } else {
                $queries[] = $rawQuery;
            }
        }
    }

    if (!extension_loaded('mysqli') || !function_exists('mysqli_init')) {
        pyro_send_header(203);
        echo pyro_pack_block('The PHP mysqli extension is not available on this server.');
        pyro_finish_response();
    }

    mysqli_report(MYSQLI_REPORT_OFF);
    [$tlsMode, $tlsCa] = pyro_configured_db_tls();
    $tlsPlan = pyro_db_tls_plan($tlsMode, $tlsCa, pyro_is_loopback_target($host));
    if ($tlsPlan['warn_plaintext']) {
        // Informational only: the binary protocol is unchanged
        header('X-Pyro-Db-Tls: off');
    }
    $conn = pyro_db_connect($tlsPlan, $host, $login, $password, $port);

    if ($tlsPlan['require_cipher']) {
        $cipher = '';
        $res = @$conn->query("SHOW STATUS LIKE 'Ssl_cipher'");
        if ($res instanceof mysqli_result) {
            $row = $res->fetch_row();
            $cipher = is_array($row) ? (string) ($row[1] ?? '') : '';
            $res->free();
        }
        if ($cipher === '') {
            pyro_send_header(217);
            echo pyro_pack_block('The database server does not offer TLS.');
            pyro_finish_response($conn);
        }
    }

    // Use full 4-byte UTF-8 (utf8mb4) with fallback to utf8
    if (!@$conn->set_charset('utf8mb4')) {
        @$conn->set_charset('utf8');
    }

    if ($database !== '') {
        if (!@$conn->select_db($database)) {
            $errno = $conn->errno ?: 1049;
            $errMsg = $conn->error ?: "Unknown database '$database'";
            pyro_send_header($errno);
            echo pyro_pack_block($errMsg);
            pyro_finish_response($conn);
        }
    }

    // Connection succeeded
    pyro_send_header(0);

    if ($action === 'C') {
        pyro_emit_connection_info($conn);
    } elseif ($action === 'K') {
        $safeQid = $conn->real_escape_string($_POST['qid']);
        $findSql = "SELECT ID FROM information_schema.PROCESSLIST WHERE INFO LIKE '%pyro_qid:"
            . $safeQid . "%' AND ID != CONNECTION_ID() LIMIT 1";
        $killed = false;
        $res = @$conn->query($findSql);
        if ($res instanceof mysqli_result) {
            $row = $res->fetch_row();
            if ($row && isset($row[0])) {
                $targetId = (int) $row[0];
                if ($targetId > 0) {
                    @$conn->query('KILL QUERY ' . $targetId);
                    $killed = ($conn->errno === 0);
                }
            }
            $res->free();
        }
        echo pyro_pack_block(
            $killed
                ? 'Query cancelled successfully'
                : 'Query not found or already completed'
        );
    } elseif ($action === 'Q') {
        $queryCount = count($queries);
        for ($idx = 0; $idx < $queryCount; $idx++) {
            $sql = $queries[$idx];
            if (trim($sql) === '') {
                continue;
            }

            $ok = @$conn->real_query($sql);
            $errno = $conn->errno;
            $affectedRows = $conn->affected_rows < 0 ? 0 : $conn->affected_rows;
            $insertId = $conn->insert_id;
            $res = false;

            if ($ok && $conn->field_count > 0) {
                $res = @$conn->store_result();
                if ($res === false && $conn->errno > 0) {
                    $errno = $conn->errno;
                }
            }

            if ($res instanceof mysqli_result) {
                $numFields = $conn->field_count;
                $numRows = (int) $res->num_rows;
                if ($numRows > PYRO_MAX_ROWS_PER_RESULT) {
                    $errno = 211;
                    $numFields = 0;
                    $numRows = 0;
                }
            } else {
                $numFields = 0;
                $numRows = 0;
            }

            pyro_emit_result_header($errno, $affectedRows, $insertId, $numFields, $numRows);

            if ($errno > 0) {
                $errorText = ($errno === 211)
                    ? 'Result exceeds ' . PYRO_MAX_ROWS_PER_RESULT . ' rows; add a restrictive LIMIT.'
                    : ($conn->error ?: 'Query execution error');
                echo pyro_pack_block($errorText);
            } elseif ($numFields > 0 && $res instanceof mysqli_result) {
                pyro_emit_fields_metadata($res, $numFields);
                pyro_emit_rows($res, $numFields, $numRows);
            } else {
                echo pyro_pack_block($conn->info ?? '');
            }

            if ($res instanceof mysqli_result) {
                $res->free();
            }

            // Flush any additional multi-query results on the connection to keep state clean
            while ($conn->more_results()) {
                $conn->next_result();
                if ($extraRes = $conn->store_result()) {
                    $extraRes->free();
                }
            }

            echo ($idx < $queryCount - 1) ? "\x01" : "\x00";
        }
    }

    pyro_finish_response($conn);
}

header('Content-Type: text/html; charset=UTF-8');
?>
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>PyroStudio — PyroTunnel v1 Diagnostic</title>
    <style>
        :root {
            color-scheme: dark;
        }
        * {
            box-sizing: border-box;
        }
        body {
            margin: 0;
            padding: 40px 20px;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Inter, sans-serif;
            background: #090b10;
            color: #e5e7eb;
            line-height: 1.5;
        }
        .container {
            max-width: 640px;
            margin: 0 auto;
        }
        .header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 24px;
            padding-bottom: 16px;
            border-bottom: 1px solid #1e2436;
        }
        .brand {
            display: flex;
            align-items: center;
            gap: 12px;
        }
        .brand-badge {
            width: 36px;
            height: 36px;
            border-radius: 10px;
            background: linear-gradient(135deg, #ea580c, #f59e0b);
            display: flex;
            align-items: center;
            justify-content: center;
            font-weight: 800;
            color: #fff;
            font-size: 18px;
        }
        .brand h1 {
            margin: 0;
            font-size: 20px;
            font-weight: 700;
            color: #ffffff;
        }
        .brand p {
            margin: 0;
            font-size: 12px;
            color: #9ca3af;
        }
        .version-pill {
            font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
            font-size: 11px;
            padding: 4px 10px;
            border-radius: 9999px;
            background: rgba(234, 88, 12, 0.15);
            color: #fb923c;
            border: 1px solid rgba(234, 88, 12, 0.35);
        }
        .card {
            background: #10141f;
            border: 1px solid #1e2436;
            border-radius: 12px;
            padding: 20px;
            margin-bottom: 20px;
        }
        .card h2 {
            margin: 0 0 14px 0;
            font-size: 14px;
            font-weight: 600;
            color: #f3f4f6;
            text-transform: uppercase;
            letter-spacing: 0.04em;
        }
        .check-row {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 8px 0;
            border-bottom: 1px solid #181e2e;
            font-size: 13px;
        }
        .check-row:last-child {
            border-bottom: none;
        }
        .ok {
            color: #34d399;
            font-weight: 600;
            font-family: ui-monospace, SFMono-Regular, monospace;
        }
        .fail {
            color: #f87171;
            font-weight: 600;
            font-family: ui-monospace, SFMono-Regular, monospace;
        }
        .grid {
            display: grid;
            grid-template-columns: 2fr 1fr;
            gap: 12px;
            margin-bottom: 12px;
        }
        .grid-half {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 12px;
            margin-bottom: 16px;
        }
        label {
            display: block;
            font-size: 12px;
            color: #9ca3af;
            margin-bottom: 4px;
        }
        input {
            width: 100%;
            padding: 8px 12px;
            background: #0a0c12;
            border: 1px solid #262e42;
            border-radius: 8px;
            color: #fff;
            font-size: 13px;
            font-family: ui-monospace, SFMono-Regular, monospace;
        }
        input:focus {
            outline: none;
            border-color: #f97316;
        }
        button {
            background: linear-gradient(90deg, #ea580c, #d97706);
            color: #fff;
            border: none;
            border-radius: 8px;
            padding: 9px 18px;
            font-size: 13px;
            font-weight: 600;
            cursor: pointer;
        }
        button:hover {
            opacity: 0.95;
        }
        #testResult {
            margin-top: 14px;
            font-size: 13px;
            font-family: ui-monospace, SFMono-Regular, monospace;
            padding: 10px 12px;
            border-radius: 8px;
            display: none;
        }
        .res-ok {
            display: block !important;
            background: rgba(16, 185, 129, 0.12);
            border: 1px solid rgba(16, 185, 129, 0.35);
            color: #6ee7b7;
        }
        .res-err {
            display: block !important;
            background: rgba(239, 68, 68, 0.12);
            border: 1px solid rgba(239, 68, 68, 0.35);
            color: #fca5a5;
        }
    </style>
</head>
<body>
<div class="container">
    <div class="header">
        <div class="brand">
            <div class="brand-badge">P</div>
            <div>
                <h1>PyroStudio HTTP Tunnel</h1>
                <p>Motor binario nativo de transporte para MariaDB y MySQL</p>
            </div>
        </div>
        <span class="version-pill">PyroTunnel v<?= PYRO_TUNNEL_VERSION ?>.0</span>
    </div>

    <div class="card">
        <h2>Diagnóstico</h2>
        <p>
            El túnel está configurado con token. Por seguridad, esta página no muestra detalles del servidor.
            Para probar la conexión introduzca el token del túnel (<code>PYRO_TUNNEL_TOKEN</code>).
            Desactive esta página cuando termine (<code>$allowDiagnosticPage = false</code>).
        </p>
    </div>

    <div class="card">
        <h2>Prueba de Conexión al Servidor</h2>
        <form id="testForm" onsubmit="runConnectionTest(event)">
            <div class="grid">
                <div>
                    <label>Host de Base de Datos</label>
                    <input type="text" id="host" value="localhost" required>
                </div>
                <div>
                    <label>Puerto</label>
                    <input type="number" id="port" value="3306" required>
                </div>
            </div>
            <div>
                <label>Token del túnel</label>
                <input type="password" id="token" autocomplete="off" required>
            </div>
            <div class="grid-half">
                <div>
                    <label>Usuario</label>
                    <input type="text" id="login" placeholder="root" required>
                </div>
                <div>
                    <label>Contraseña</label>
                    <input type="password" id="password" placeholder="••••••••">
                </div>
            </div>
            <button type="submit">Probar Conexión</button>
            <div id="testResult"></div>
        </form>
    </div>
</div>
<script>
function readBlock(view, bytes, offsetObj) {
    const first = view.getUint8(offsetObj.offset);
    offsetObj.offset += 1;
    let len = first;
    if (first === 0xFE) {
        len = view.getUint32(offsetObj.offset, false);
        offsetObj.offset += 4;
    }
    const slice = bytes.subarray(offsetObj.offset, offsetObj.offset + len);
    offsetObj.offset += len;
    return new TextDecoder().decode(slice);
}

async function runConnectionTest(e) {
    e.preventDefault();
    const out = document.getElementById('testResult');
    out.className = 'res-ok';
    out.textContent = 'Probando conexión con el motor MySQL/MariaDB...';

    const body = new URLSearchParams({
        actn: 'C',
        host: document.getElementById('host').value,
        port: document.getElementById('port').value,
        login: document.getElementById('login').value,
        password: document.getElementById('password').value,
        db: ''
    });

    try {
        const res = await fetch(window.location.href, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Authorization': 'Bearer ' + document.getElementById('token').value
            },
            body
        });
        const buf = await res.arrayBuffer();
        const view = new DataView(buf);
        const bytes = new Uint8Array(buf);
        if (buf.byteLength < 10) {
            out.className = 'res-err';
            out.textContent = 'Respuesta binaria incompleta (' + buf.byteLength + ' bytes).';
            return;
        }
        const magic = view.getUint32(0, false);
        const version = view.getUint16(4, false);
        const errno = view.getUint32(6, false);
        if (magic !== 0x5059524F) {
            out.className = 'res-err';
            out.textContent = 'Cabecera mágica inesperada: 0x' + magic.toString(16);
            return;
        }
        const state = { offset: 10 };
        if (errno === 0) {
            const hostInfo = readBlock(view, bytes, state);
            const protoInfo = readBlock(view, bytes, state);
            const serverInfo = readBlock(view, bytes, state);
            out.className = 'res-ok';
            out.textContent = 'Conexión exitosa (PyroTunnel v' + version + ') — Motor: ' + serverInfo + ' (' + hostInfo + ')';
        } else {
            const msg = readBlock(view, bytes, state);
            out.className = 'res-err';
            out.textContent = 'Error [' + errno + ']: ' + msg;
        }
    } catch (err) {
        out.className = 'res-err';
        out.textContent = 'Fallo de red: ' + err.message;
    }
}
</script>
</body>
</html>

