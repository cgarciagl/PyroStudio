<?php
/**
 * Pruebas de seguridad del túnel PHP.
 *
 * Levanta `php -S` con distintas variables de entorno y verifica que el túnel
 * falle cerrado. Uso: php tunnel/tests/tunnel_test.php
 */

declare(strict_types=1);

const TUNNEL_DIR = __DIR__ . '/..';
const GOOD_TOKEN = 'test-token-0123456789abcdef';

$failures = 0;
$total = 0;

function check(bool $ok, string $name): void
{
    global $failures, $total;
    $total++;
    if ($ok) {
        echo "  ok   $name\n";
    } else {
        $failures++;
        echo "  FAIL $name\n";
    }
}

/** Starts `php -S` with the given environment and returns [process, baseUrl]. */
function start_server(array $env): array
{
    $sock = stream_socket_server('tcp://127.0.0.1:0');
    $port = (int) substr(strrchr(stream_socket_get_name($sock, false), ':'), 1);
    fclose($sock);

    $fullEnv = array_merge(getenv(), $env);
    foreach (['PYRO_TUNNEL_TOKEN', 'PYRO_TUNNEL_ALLOWED_DB_HOSTS', 'PYRO_TUNNEL_DIAGNOSTIC_PAGE', 'PYRO_TUNNEL_DB_TLS', 'PYRO_TUNNEL_DB_TLS_CA'] as $key) {
        if (!array_key_exists($key, $env)) {
            unset($fullEnv[$key]);
        }
    }
    $cmd = [PHP_BINARY, '-S', "127.0.0.1:$port", '-t', TUNNEL_DIR];
    $null = PHP_OS_FAMILY === 'Windows' ? 'NUL' : '/dev/null';
    $proc = proc_open($cmd, [0 => ['pipe', 'r'], 1 => ['file', $null, 'w'], 2 => ['file', $null, 'w']], $pipes, null, $fullEnv);
    for ($i = 0; $i < 50; $i++) {
        $conn = @fsockopen('127.0.0.1', $port, $errno, $errstr, 0.1);
        if ($conn) {
            fclose($conn);
            break;
        }
        usleep(100000);
    }
    return [$proc, "http://127.0.0.1:$port/pyro_tunnel.php"];
}

function stop_server($proc): void
{
    $status = proc_get_status($proc);
    if (PHP_OS_FAMILY === 'Windows') {
        exec('taskkill /F /T /PID ' . (int) $status['pid'] . ' 2>NUL');
    } else {
        proc_terminate($proc);
    }
    proc_close($proc);
}

/** Performs a request and returns [httpStatus, errno|null, body, headers]. */
function request(string $url, string $method, array $fields = [], ?string $token = null): array
{
    $headers = ['Content-Type: application/x-www-form-urlencoded'];
    if ($token !== null) {
        $headers[] = 'Authorization: Bearer ' . $token;
    }
    $ctx = stream_context_create(['http' => [
        'method' => $method,
        'header' => implode("\r\n", $headers),
        'content' => http_build_query($fields),
        'ignore_errors' => true,
        'timeout' => 10,
    ]]);
    $body = (string) @file_get_contents($url, false, $ctx);
    $status = 0;
    foreach ($http_response_header ?? [] as $line) {
        if (preg_match('#^HTTP/\S+\s+(\d{3})#', $line, $m)) {
            $status = (int) $m[1];
        }
    }
    $errno = null;
    if (strlen($body) >= 10 && unpack('N', substr($body, 0, 4))[1] === 0x5059524F) {
        $errno = unpack('N', substr($body, 6, 4))[1];
    }
    return [$status, $errno, $body, implode("
", $http_response_header ?? [])];
}

function connect_fields(string $host, string $port = '1'): array
{
    return ['actn' => 'C', 'host' => $host, 'port' => $port, 'login' => 'nobody', 'password' => 'x'];
}

// ── Sin token: falla cerrado ───────────────────────────────────────────────
echo "Sin token configurado\n";
[$proc, $url] = start_server([]);
[$status, $errno, $body] = request($url, 'POST', connect_fields('127.0.0.1'));
check($status === 503 && $errno === 215, "POST rechazado con 503/215 (status=$status errno=" . var_export($errno, true) . ')');
check(stripos($body, 'PYRO_TUNNEL_TOKEN') !== false, 'el mensaje explica cómo configurar el token');
[$status, , $body] = request($url, 'GET');
check($status >= 400, "GET sin página de diagnóstico devuelve error (status=$status)");
check(strpos($body, PHP_VERSION) === false, 'GET no revela la versión de PHP');
stop_server($proc);

// ── Token demasiado corto ──────────────────────────────────────────────────
echo "Token demasiado corto\n";
[$proc, $url] = start_server(['PYRO_TUNNEL_TOKEN' => 'abc']);
[$status, $errno] = request($url, 'POST', connect_fields('127.0.0.1'), 'abc');
check($status === 503 && $errno === 215, "token corto se trata como no configurado (status=$status)");
stop_server($proc);

// ── Token válido ───────────────────────────────────────────────────────────
echo "Token configurado\n";
[$proc, $url] = start_server(['PYRO_TUNNEL_TOKEN' => GOOD_TOKEN]);
[$status, $errno] = request($url, 'POST', connect_fields('127.0.0.1'));
check($status === 401 && $errno === 212, "sin Authorization -> 401/212 (status=$status)");
[$status, $errno] = request($url, 'POST', connect_fields('127.0.0.1'), 'otro-token-incorrecto-xxxx');
check($status === 401 && $errno === 212, "token incorrecto -> 401/212 (status=$status)");
[$status, $errno] = request($url, 'POST', connect_fields('10.0.0.5'), GOOD_TOKEN);
check($status === 403 && $errno === 206, "host remoto sin allowlist -> 403/206 (status=$status)");
foreach (['127.0.0.1', 'localhost', '::1', '[::1]'] as $host) {
    [$status, $errno] = request($url, 'POST', connect_fields($host), GOOD_TOKEN);
    check(!in_array($errno, [206, 212, 215], true), "host $host permitido por defecto (errno=" . var_export($errno, true) . ')');
}
stop_server($proc);

// ── Allowlist explícita ────────────────────────────────────────────────────
echo "Allowlist explícita\n";
[$proc, $url] = start_server(['PYRO_TUNNEL_TOKEN' => GOOD_TOKEN, 'PYRO_TUNNEL_ALLOWED_DB_HOSTS' => 'db.invalid']);
[$status, $errno] = request($url, 'POST', connect_fields('db.invalid'), GOOD_TOKEN);
check(!in_array($errno, [206, 212, 215], true), "host en allowlist permitido (errno=" . var_export($errno, true) . ')');
[$status, $errno] = request($url, 'POST', connect_fields('127.0.0.1'), GOOD_TOKEN);
check($errno === 206, 'con allowlist explícita, localhost también debe estar listado');
stop_server($proc);

// ── Comodín * y bloqueos fijos ─────────────────────────────────────────────
echo "Allowlist con *\n";
[$proc, $url] = start_server(['PYRO_TUNNEL_TOKEN' => GOOD_TOKEN, 'PYRO_TUNNEL_ALLOWED_DB_HOSTS' => '*,10.0.0.0/33']);
[$status, $errno] = request($url, 'POST', connect_fields('169.254.169.254'), GOOD_TOKEN);
check($status === 403 && $errno === 206, "* no desbloquea 169.254.169.254 (status=$status)");
[$status, $errno] = request($url, 'POST', connect_fields('0xa9fea9fe'), GOOD_TOKEN);
check($errno === 206, 'forma hexadecimal de 169.254.169.254 bloqueada');
[$status, $errno] = request($url, 'POST', connect_fields('192.168.1.1'), GOOD_TOKEN);
check(!in_array($errno, [206, 212, 215], true), '* permite redes privadas (errno=' . var_export($errno, true) . ')');
[$status, $errno] = request($url, 'POST', connect_fields('192.168.1.1'));
check($status === 401 && $errno === 212, "* sin token -> 401/212 (status=$status)");
stop_server($proc);

echo "Formas raras de host\n";
[$proc, $url] = start_server(['PYRO_TUNNEL_TOKEN' => GOOD_TOKEN]);
[$status, $errno] = request($url, 'POST', connect_fields('p:localhost'), GOOD_TOKEN);
check($errno === 206, 'p:localhost rechazado (errno=' . var_export($errno, true) . ')');
[$status, $errno] = request($url, 'POST', connect_fields('127.1'), GOOD_TOKEN);
check(!in_array($errno, [206, 212, 215], true), '127.1 se normaliza a 127.0.0.1 (errno=' . var_export($errno, true) . ')');
stop_server($proc);

// ── TLS hacia la base de datos ─────────────────────────────────────────────
echo "TLS hacia la base de datos\n";
[$proc, $url] = start_server(['PYRO_TUNNEL_TOKEN' => GOOD_TOKEN]);
[, $errno, , $headers] = request($url, 'POST', connect_fields('127.0.0.1'), GOOD_TOKEN);
check(stripos($headers, 'X-Pyro-Db-Tls') === false, 'off hacia loopback no envía X-Pyro-Db-Tls');
stop_server($proc);
[$proc, $url] = start_server(['PYRO_TUNNEL_TOKEN' => GOOD_TOKEN, 'PYRO_TUNNEL_DB_TLS' => 'required']);
[$status, $errno] = request($url, 'POST', connect_fields('127.0.0.1'), GOOD_TOKEN);
check($errno === 217, 'required sin servidor TLS -> 217 (errno=' . var_export($errno, true) . ')');
stop_server($proc);
[$proc, $url] = start_server(['PYRO_TUNNEL_TOKEN' => GOOD_TOKEN, 'PYRO_TUNNEL_DB_TLS' => 'quizas']);
[$status, $errno] = request($url, 'POST', connect_fields('127.0.0.1'), GOOD_TOKEN);
check($errno === 217, 'modo inválido se trata como required (errno=' . var_export($errno, true) . ')');
stop_server($proc);
[$proc, $url] = start_server(['PYRO_TUNNEL_TOKEN' => GOOD_TOKEN, 'PYRO_TUNNEL_DB_TLS' => 'preferred']);
[$status, $errno] = request($url, 'POST', connect_fields('127.0.0.1'), GOOD_TOKEN);
check(!in_array($errno, [206, 212, 215, 217], true), 'preferred cae a texto claro (errno=' . var_export($errno, true) . ')');
stop_server($proc);

// ── Página de diagnóstico activada ─────────────────────────────────────────
echo "Página de diagnóstico\n";
[$proc, $url] = start_server(['PYRO_TUNNEL_TOKEN' => GOOD_TOKEN, 'PYRO_TUNNEL_DIAGNOSTIC_PAGE' => '1']);
[$status, , $body] = request($url, 'GET');
check($status === 200 && strpos($body, 'PyroStudio HTTP Tunnel') !== false, "se muestra si se activa (status=$status)");
check(strpos($body, PHP_VERSION) === false, 'no revela la versión de PHP');
check(stripos($body, 'Solo Localhost (Por defecto)') === false, 'sin la etiqueta engañosa anterior');
stop_server($proc);

echo "\n$total pruebas, $failures fallos\n";
exit($failures === 0 ? 0 : 1);
