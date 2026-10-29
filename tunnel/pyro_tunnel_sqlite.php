<?php
/**
 * PyroStudio HTTP Tunnel for SQLite (PyroTunnel v1)
 * High-performance binary HTTP tunnel for SQLite databases.
 *
 * Protocol: PyroTunnel Binary v1 (Magic: "PYRO" / 0x5059524F)
 * License: MIT - PyroStudio Project
 *
 * Security (fails closed, same model as pyro_tunnel.php):
 * - A token is required (PYRO_TUNNEL_TOKEN or $tunnelToken, >= 16 chars),
 *   sent as "Authorization: Bearer <token>" or "X-Pyro-Token: <token>".
 *   Generate one with: php -r "echo bin2hex(random_bytes(32)), PHP_EOL;"
 * - Brute force limiter: 5 wrong tokens from one IP in 5 minutes -> HTTP 429
 *   (219) with Retry-After. Counters live in sys_get_temp_dir(); disable it
 *   with PYRO_TUNNEL_RATE_LIMIT=off. X-Forwarded-For is ignored unless
 *   PYRO_TUNNEL_TRUSTED_PROXY=1 (then its last entry is used).
 * - The host/port allowlists and DB TLS of pyro_tunnel.php do not apply: the
 *   database is a local file.
 *
 * - The database file is sent as "dbfile" and must already exist: a mistyped
 *   path never creates an empty database. PYRO_TUNNEL_SQLITE_DIR limits the
 *   reachable files to one directory.
 *
 * Environment variables (effect / default):
 *   PYRO_TUNNEL_TOKEN             required token / none (rejects everything)
 *   PYRO_TUNNEL_RATE_LIMIT        'off' disables the limiter / on
 *   PYRO_TUNNEL_TRUSTED_PROXY     '1' trusts X-Forwarded-For / off
 *   PYRO_TUNNEL_SQLITE_DIR        only files inside this directory / any file
 */

declare(strict_types=1);

const PYRO_TUNNEL_MAGIC = 0x5059524F; // "PYRO"
const PYRO_TUNNEL_VERSION = 1;
const PYRO_MAX_REQUEST_BYTES = 8388608; // 8 MiB
const PYRO_MAX_SINGLE_QUERY_BYTES = 4194304; // 4 MiB
const PYRO_MAX_QUERIES_PER_BATCH = 100;
const PYRO_MAX_ROWS_PER_RESULT = 20000;
// Announced in X-Pyro-Tunnel-Caps. 'stop-on-error': a batch stops at the first
// failing query, so PyroStudio may send an editor script as a list of queries.
const PYRO_TUNNEL_CAPS = 'stop-on-error';

const PYRO_MIN_TOKEN_LENGTH = 16;

// REQUIRED: secret token for Bearer authentication (minimum 16 characters).
// Prefer the environment variable PYRO_TUNNEL_TOKEN. Without a token the tunnel
// rejects every request (fail closed).
$tunnelToken = '';

error_reporting(0);
ini_set('display_errors', '0');
header_remove('X-Powered-By');
set_time_limit(120);

// Global shutdown handler
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

function pyro_finish_response(?SQLite3 $db = null): void
{
    if ($db instanceof SQLite3) {
        @$db->close();
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

// -----------------------------------------------------------------------------
// Brute force limiter for the token
// -----------------------------------------------------------------------------

/**
 * Failed token attempts per client IP are kept in sys_get_temp_dir(), one
 * file per IP named after an HMAC of the IP (keyed with the tunnel token, so
 * the IP is not stored in clear nor guessable from the name). It fails OPEN:
 * a file system error disables the limiter for that request, never the token
 * check. Disable it with PYRO_TUNNEL_RATE_LIMIT=off.
 */
const PYRO_RATE_LIMIT_MAX_FAILURES = 5;
const PYRO_RATE_LIMIT_WINDOW_SECONDS = 300;
const PYRO_RATE_LIMIT_FILE_PREFIX = 'pyro_tunnel_rl_';

/** @param string|false $setting value of PYRO_TUNNEL_RATE_LIMIT */
function pyro_rate_limit_enabled($setting): bool
{
    if ($setting === false) {
        return true;
    }
    return !in_array(strtolower(trim($setting)), ['off', '0', 'false', 'no'], true);
}

/**
 * Client address for the limiter. X-Forwarded-For is trusted only when
 * PYRO_TUNNEL_TRUSTED_PROXY=1, and then its LAST entry (the one added by your
 * own proxy; earlier entries are supplied by the client and can be forged).
 */
function pyro_client_ip(array $server, bool $trustProxy): string
{
    if ($trustProxy && isset($server['HTTP_X_FORWARDED_FOR']) && is_string($server['HTTP_X_FORWARDED_FOR'])) {
        $hops = explode(',', $server['HTTP_X_FORWARDED_FOR']);
        $last = trim((string) end($hops));
        if (filter_var($last, FILTER_VALIDATE_IP)) {
            return $last;
        }
    }
    $remote = $server['REMOTE_ADDR'] ?? '';
    return is_string($remote) ? $remote : '';
}

function pyro_rate_limit_key(string $clientIp, string $secret): string
{
    return hash_hmac('sha256', $clientIp, $secret);
}

function pyro_rate_limit_path(string $dir, string $key): string
{
    return rtrim($dir, '/\\') . DIRECTORY_SEPARATOR . PYRO_RATE_LIMIT_FILE_PREFIX . $key . '.json';
}

/** Failure timestamps still inside the window. */
function pyro_rate_limit_recent(array $times, int $now): array
{
    $recent = [];
    foreach ($times as $time) {
        if (is_int($time) && $time > $now - PYRO_RATE_LIMIT_WINDOW_SECONDS && $time <= $now) {
            $recent[] = $time;
        }
    }
    return $recent;
}

/** @return array<int, int> */
function pyro_rate_limit_read($handle): array
{
    $raw = stream_get_contents($handle);
    $times = is_string($raw) ? json_decode($raw, true) : null;
    return is_array($times) ? $times : [];
}

/**
 * Whether $key is blocked at $now and for how many seconds more.
 *
 * @return array{blocked: bool, retry_after: int}
 */
function pyro_rate_limit_status(string $dir, string $key, int $now): array
{
    $open = ['blocked' => false, 'retry_after' => 0];
    $path = pyro_rate_limit_path($dir, $key);
    if (!is_file($path)) {
        return $open;
    }
    $handle = @fopen($path, 'rb');
    if ($handle === false) {
        return $open;
    }
    $times = [];
    if (@flock($handle, LOCK_SH)) {
        $times = pyro_rate_limit_recent(pyro_rate_limit_read($handle), $now);
        flock($handle, LOCK_UN);
    }
    fclose($handle);
    if (count($times) < PYRO_RATE_LIMIT_MAX_FAILURES) {
        return $open;
    }
    // Unblocked once enough failures leave the window
    sort($times);
    $releasing = $times[count($times) - PYRO_RATE_LIMIT_MAX_FAILURES];
    return ['blocked' => true, 'retry_after' => max(1, $releasing + PYRO_RATE_LIMIT_WINDOW_SECONDS - $now)];
}

/** Records a failed attempt. Returns false (silently) on file system errors. */
function pyro_rate_limit_fail(string $dir, string $key, int $now): bool
{
    $handle = @fopen(pyro_rate_limit_path($dir, $key), 'c+b');
    if ($handle === false) {
        return false;
    }
    $ok = false;
    if (@flock($handle, LOCK_EX)) {
        $times = pyro_rate_limit_recent(pyro_rate_limit_read($handle), $now);
        $times[] = $now;
        $ok = ftruncate($handle, 0) && rewind($handle)
            && fwrite($handle, (string) json_encode($times)) !== false;
        fflush($handle);
        flock($handle, LOCK_UN);
    }
    fclose($handle);
    return $ok;
}

function pyro_rate_limit_reset(string $dir, string $key): void
{
    $path = pyro_rate_limit_path($dir, $key);
    if (is_file($path)) {
        @unlink($path);
    }
}

/** Deletes counters not touched during the last window. */
function pyro_rate_limit_cleanup(string $dir, int $now): void
{
    $files = @glob(rtrim($dir, '/\\') . DIRECTORY_SEPARATOR . PYRO_RATE_LIMIT_FILE_PREFIX . '*.json');
    foreach (is_array($files) ? $files : [] as $file) {
        $mtime = @filemtime($file);
        if ($mtime !== false && $mtime < $now - PYRO_RATE_LIMIT_WINDOW_SECONDS) {
            @unlink($file);
        }
    }
}

// Included as a library (unit tests): define the functions only.
/**
 * Whether a statement returns rows. Leading comments are skipped, so queries
 * tagged with a leading pyro_qid comment are still recognized.
 */
function pyro_returns_rows(string $sql): bool
{
    $statement = (string) preg_replace('/^(?:\s+|--[^\n]*(?:\n|$)|\/\*.*?\*\/)*/s', '', $sql);
    return (bool) preg_match('/^(SELECT|PRAGMA|EXPLAIN|WITH|VALUES)\b/i', $statement);
}

/**
 * Type code reported for a column from the storage classes of all its
 * non-null values: SQLite is dynamically typed, so the first row is not
 * enough. Mixed numeric columns are FLOAT; any other mix is TEXT.
 *
 * @param array<int, bool> $seen storage classes seen, as keys
 */
function pyro_column_type(array $seen): int
{
    $classes = array_keys($seen);
    sort($classes);
    if ($classes === [SQLITE3_INTEGER]) {
        return SQLITE3_INTEGER;
    }
    if ($classes === [SQLITE3_FLOAT] || $classes === [SQLITE3_INTEGER, SQLITE3_FLOAT]) {
        return SQLITE3_FLOAT;
    }
    if ($classes === [SQLITE3_BLOB]) {
        return SQLITE3_BLOB;
    }
    return SQLITE3_TEXT;
}

/** Resolved database path, or null when it is missing or outside the allowed directory. */
function pyro_resolve_database_path(string $path, $allowedDir): ?string
{
    if (trim($path) === '') {
        return null;
    }
    $real = realpath($path);
    if ($real === false || !is_file($real)) {
        return null;
    }
    if (is_string($allowedDir) && $allowedDir !== '') {
        $root = realpath($allowedDir);
        if ($root === false || strpos($real, rtrim($root, '\\/') . DIRECTORY_SEPARATOR) !== 0) {
            return null;
        }
    }
    return $real;
}

if (defined('PYRO_TUNNEL_LIB')) {
    return;
}

$isPostRequest = (($_SERVER['REQUEST_METHOD'] ?? '') === 'POST') || !empty($_POST);
$action = $_POST['actn'] ?? '';
$requiredToken = pyro_required_token();

// Fail closed: without a configured token the tunnel refuses every request.
if ($requiredToken === '') {
    pyro_reject_request(
        215,
        'PyroTunnel is not configured: set the PYRO_TUNNEL_TOKEN environment variable '
        . '(or $tunnelToken in pyro_tunnel_sqlite.php) to a secret of at least '
        . PYRO_MIN_TOKEN_LENGTH . ' characters.',
        503
    );
}

if (!$isPostRequest || empty($action)) {
    pyro_reject_request(202, 'Invalid tunnel parameters.', 400);
}

// Brute force limiter: a blocked client is rejected before its token is
// even compared, so a correct token cannot reset an active block.
$rateLimitOn = pyro_rate_limit_enabled(getenv('PYRO_TUNNEL_RATE_LIMIT'));
$rateLimitDir = sys_get_temp_dir();
$rateLimitKey = pyro_rate_limit_key(
    pyro_client_ip($_SERVER, getenv('PYRO_TUNNEL_TRUSTED_PROXY') === '1'),
    $requiredToken
);
if ($rateLimitOn) {
    $now = time();
    if (mt_rand(1, 50) === 1) {
        pyro_rate_limit_cleanup($rateLimitDir, $now);
    }
    $limit = pyro_rate_limit_status($rateLimitDir, $rateLimitKey, $now);
    if ($limit['blocked']) {
        header('Retry-After: ' . $limit['retry_after']);
        pyro_reject_request(219, 'Too many failed authentication attempts. Retry in '
            . $limit['retry_after'] . ' seconds.', 429);
    }
}

if (!hash_equals($requiredToken, pyro_presented_token())) {
    if ($rateLimitOn) {
        pyro_rate_limit_fail($rateLimitDir, $rateLimitKey, time());
    }
    pyro_reject_request(212, 'Invalid authentication token.', 401);
}
if ($rateLimitOn) {
    pyro_rate_limit_reset($rateLimitDir, $rateLimitKey);
}

ob_start();
header('Content-Type: application/octet-stream');
header('Cache-Control: no-store, no-cache, must-revalidate');
header('X-Pyro-Tunnel-Caps: ' . PYRO_TUNNEL_CAPS);

$dbPath = $_POST['dbfile'] ?? $_POST['db'] ?? '';
if (empty($dbPath) && isset($_POST['host']) && str_ends_with($_POST['host'], '.sqlite3')) {
    $dbPath = $_POST['host'];
}

if (!class_exists('SQLite3')) {
    pyro_send_header(203);
    echo pyro_pack_block('The PHP SQLite3 extension is not available on this server.');
    pyro_finish_response();
}

$resolvedPath = pyro_resolve_database_path((string) $dbPath, getenv('PYRO_TUNNEL_SQLITE_DIR'));
if ($resolvedPath === null) {
    pyro_send_header(2002);
    echo pyro_pack_block('SQLite database file not found or not allowed: ' . $dbPath);
    pyro_finish_response();
}

try {
    $db = new SQLite3($resolvedPath, SQLITE3_OPEN_READWRITE);
    $db->busyTimeout(5000);
    // Same default as PyroStudio's local connections.
    $db->exec('PRAGMA foreign_keys = ON');
} catch (Exception $e) {
    pyro_send_header(2002);
    echo pyro_pack_block('Unable to open SQLite database: ' . $e->getMessage());
    pyro_finish_response();
}

pyro_send_header(0);

if ($action === 'C') {
    $versionInfo = SQLite3::version();
    echo pyro_pack_block('SQLite3 v' . ($versionInfo['versionString'] ?? '3'))
        . pyro_pack_block((string) ($versionInfo['versionNumber'] ?? '3'))
        . pyro_pack_block('SQLite ' . ($versionInfo['versionString'] ?? '3'));
    pyro_finish_response($db);
}

if ($action === 'Q') {
    $queries = $_POST['q'] ?? [];
    if (!is_array($queries) || count($queries) === 0) {
        pyro_finish_response($db);
    }

    $encodeBase64 = ($_POST['encodeBase64'] ?? '0') === '1';
    $queryCount = count($queries);

    for ($idx = 0; $idx < $queryCount; $idx++) {
        $sql = $queries[$idx];
        if (!is_string($sql) || trim($sql) === '') {
            continue;
        }

        if ($encodeBase64) {
            $decoded = base64_decode($sql, true);
            if ($decoded !== false) {
                $sql = $decoded;
            }
        }

        $errno = 0;
        $trimmed = trim($sql);
        $isQuery = pyro_returns_rows($trimmed);

        if ($isQuery) {
            $res = @$db->query($sql);
            if ($res === false) {
                $errno = $db->lastErrorCode() ?: 1;
                $errMsg = $db->lastErrorMsg() ?: 'Query execution error';
                echo pyro_pack_u32($errno)
                    . pyro_pack_u64(0)
                    . pyro_pack_u64(0)
                    . pyro_pack_u32(0)
                    . pyro_pack_u32(0);
                echo pyro_pack_block($errMsg);
            } else {
                $numFields = $res->numColumns();
                $rows = [];
                $seenClasses = array_fill(0, $numFields, []);
                while ($row = $res->fetchArray(SQLITE3_NUM)) {
                    for ($f = 0; $f < $numFields; $f++) {
                        $class = $res->columnType($f);
                        if ($class !== false && $class !== SQLITE3_NULL) {
                            $seenClasses[$f][$class] = true;
                        }
                    }
                    if (count($rows) >= PYRO_MAX_ROWS_PER_RESULT) {
                        $errno = 211;
                        break;
                    }
                    $rows[] = $row;
                }
                $numRows = count($rows);

                if ($errno === 211) {
                    $rows = [];
                    echo pyro_pack_u32($errno)
                        . pyro_pack_u64(0)
                        . pyro_pack_u64(0)
                        . pyro_pack_u32(0)
                        . pyro_pack_u32(0);
                    echo pyro_pack_block(
                        'Result exceeds ' . PYRO_MAX_ROWS_PER_RESULT . ' rows; add a restrictive LIMIT.'
                    );
                } else {
                    echo pyro_pack_u32(0)
                        . pyro_pack_u64(0)
                        . pyro_pack_u64(0)
                        . pyro_pack_u32($numFields)
                        . pyro_pack_u32($numRows);

                    // Field metadata
                    for ($f = 0; $f < $numFields; $f++) {
                        $colName = $res->columnName($f);
                        $colType = pyro_column_type($seenClasses[$f]);

                        echo pyro_pack_block($colName)
                            . pyro_pack_block('')
                            . pyro_pack_u16((int) $colType)
                            . pyro_pack_u16(0)
                            . pyro_pack_u32(0);
                    }

                    // Rows
                    foreach ($rows as $row) {
                        for ($f = 0; $f < $numFields; $f++) {
                            $cell = $row[$f];
                            if ($cell === null) {
                                echo "\xFF";
                            } else {
                                echo pyro_pack_block((string) $cell);
                            }
                        }
                    }
                }

                // Free the result now: if it were only destroyed when $res is
                // reassigned, that would wipe the next query's error message.
                unset($res);
            }
        } else {
            $ok = @$db->exec($sql);
            if (!$ok) {
                $errno = $db->lastErrorCode() ?: 1;
                $errMsg = $db->lastErrorMsg() ?: 'Execution error';
                echo pyro_pack_u32($errno)
                    . pyro_pack_u64(0)
                    . pyro_pack_u64(0)
                    . pyro_pack_u32(0)
                    . pyro_pack_u32(0);
                echo pyro_pack_block($errMsg);
            } else {
                $affected = $db->changes();
                $insertId = $db->lastInsertRowID();
                echo pyro_pack_u32(0)
                    . pyro_pack_u64($affected)
                    . pyro_pack_u64($insertId)
                    . pyro_pack_u32(0)
                    . pyro_pack_u32(0);
                echo pyro_pack_block('');
            }
        }

        // Like the sqlite3 shell with .bail on, stop at the first failing query:
        // later ones (e.g. a COMMIT after a failed write) must never run.
        if ($errno > 0) {
            echo "\x00";
            break;
        }

        echo ($idx < $queryCount - 1) ? "\x01" : "\x00";
    }
}

pyro_finish_response($db);
