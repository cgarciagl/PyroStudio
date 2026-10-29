<?php
/**
 * Pruebas del túnel PHP para SQLite.
 *
 * Levanta `php -S` contra pyro_tunnel_sqlite.php y verifica el protocolo con
 * una base temporal. Requiere la extensión sqlite3.
 * Uso: php tunnel/tests/tunnel_sqlite_test.php
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

/** Starts `php -S` with the given environment and returns [process, url]. */
function start_server(array $env): array
{
    $sock = stream_socket_server('tcp://127.0.0.1:0');
    $port = (int) substr(strrchr(stream_socket_get_name($sock, false), ':'), 1);
    fclose($sock);
    $fullEnv = array_merge(getenv(), ['PYRO_TUNNEL_TOKEN' => GOOD_TOKEN, 'PYRO_TUNNEL_RATE_LIMIT' => 'off'], $env);
    if (!array_key_exists('PYRO_TUNNEL_SQLITE_DIR', $env)) {
        unset($fullEnv['PYRO_TUNNEL_SQLITE_DIR']);
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
    return [$proc, "http://127.0.0.1:$port/pyro_tunnel_sqlite.php"];
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

function post(string $url, array $fields): string
{
    $ctx = stream_context_create(['http' => [
        'method' => 'POST',
        'header' => "Content-Type: application/x-www-form-urlencoded\r\nAuthorization: Bearer " . GOOD_TOKEN,
        'content' => http_build_query($fields),
        'ignore_errors' => true,
        'timeout' => 10,
    ]]);
    return (string) @file_get_contents($url, false, $ctx);
}

/** Minimal reader for the PyroTunnel v1 binary protocol. */
final class Reader
{
    private int $offset = 0;

    public function __construct(private string $data)
    {
    }

    public function u16(): int
    {
        $value = unpack('n', substr($this->data, $this->offset, 2))[1];
        $this->offset += 2;
        return $value;
    }

    public function u32(): int
    {
        $value = unpack('N', substr($this->data, $this->offset, 4))[1];
        $this->offset += 4;
        return $value;
    }

    public function u64(): int
    {
        $value = unpack('J', substr($this->data, $this->offset, 8))[1];
        $this->offset += 8;
        return $value;
    }

    public function block(): ?string
    {
        $length = ord($this->data[$this->offset++]);
        if ($length === 0xFF) {
            return null;
        }
        if ($length === 0xFE) {
            $length = $this->u32();
        }
        $value = substr($this->data, $this->offset, $length);
        $this->offset += $length;
        return $value;
    }

    public function byte(): int
    {
        return ord($this->data[$this->offset++]);
    }

    public function done(): bool
    {
        return $this->offset >= strlen($this->data);
    }
}

/**
 * Parses a query batch: [headerErrno, results]. Each result has errno,
 * affected, types, rows and message.
 */
function parse_batch(string $body): array
{
    $reader = new Reader($body);
    $reader->u32();
    $reader->u16();
    $headerErrno = $reader->u32();
    $results = [];
    while ($headerErrno === 0 && !$reader->done()) {
        $result = ['errno' => $reader->u32(), 'affected' => $reader->u64()];
        $reader->u64();
        $fields = $reader->u32();
        $rows = $reader->u32();
        $result['types'] = [];
        $result['rows'] = [];
        if ($result['errno'] > 0 || $fields === 0) {
            $result['message'] = $reader->block();
        } else {
            for ($f = 0; $f < $fields; $f++) {
                $reader->block();
                $reader->block();
                $result['types'][] = $reader->u16();
                $reader->u16();
                $reader->u32();
            }
            for ($r = 0; $r < $rows; $r++) {
                $row = [];
                for ($f = 0; $f < $fields; $f++) {
                    $row[] = $reader->block();
                }
                $result['rows'][] = $row;
            }
        }
        $results[] = $result;
        if ($reader->done() || $reader->byte() === 0x00) {
            break;
        }
    }
    return [$headerErrno, $results];
}

function query(string $url, string $file, array $queries): array
{
    $fields = ['actn' => 'Q', 'dbfile' => $file, 'encodeBase64' => '1'];
    $fields['q'] = array_map('base64_encode', $queries);
    return parse_batch(post($url, $fields));
}

$dir = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'pyro_sqlite_test_' . bin2hex(random_bytes(6));
mkdir($dir);
$file = $dir . DIRECTORY_SEPARATOR . 'app.sqlite3';
$seed = new SQLite3($file);
$seed->exec("CREATE TABLE parent (id INTEGER PRIMARY KEY);
             CREATE TABLE child (parent_id INTEGER REFERENCES parent(id));
             CREATE TABLE mixed (a, b INTEGER);
             INSERT INTO mixed VALUES (1, 10), ('texto', 20), (2.5, 30);");
$seed->close();

echo "Túnel SQLite\n";
[$proc, $url] = start_server([]);

$reader = new Reader(post($url, ['actn' => 'C', 'dbfile' => $file]));
$reader->u32();
$reader->u16();
check($reader->u32() === 0, 'conecta con el archivo indicado en dbfile');
$reader->block();
$reader->block();
check(str_starts_with((string) $reader->block(), 'SQLite '), 'informa la versión como "SQLite x.y.z"');

[, $results] = query($url, $file, ['SELECT a, b FROM mixed ORDER BY rowid']);
check($results[0]['types'] === [3, 1], 'el tipo de columna considera todas las filas (mixta -> TEXT)');
check($results[0]['rows'][1] === ['texto', '20'], 'devuelve los valores de cada fila');

[, $results] = query($url, $file, ["/*pyro_qid:abc*/ SELECT 1", "-- nota\nPRAGMA foreign_keys"]);
check(($results[0]['rows'][0][0] ?? null) === '1', 'reconoce SELECT con comentario inicial');
check(($results[1]['rows'][0][0] ?? null) === '1', 'activa foreign_keys en cada conexión');

[, $results] = query($url, $file, ['INSERT INTO child VALUES (99)']);
check($results[0]['errno'] > 0, 'rechaza filas que violan una clave foránea');

[, $results] = query($url, $file, [
    'INSERT INTO mixed VALUES (100, 1)',
    'INSERT INTO tabla_inexistente VALUES (1)',
    'INSERT INTO mixed VALUES (200, 2)',
]);
check(count($results) === 2 && $results[1]['errno'] > 0, 'se detiene en la primera sentencia fallida');
[, $results] = query($url, $file, ['SELECT count(*) FROM mixed WHERE a IN (100, 200)']);
check($results[0]['rows'][0][0] === '1', 'no ejecuta las sentencias posteriores al error');

$missing = $dir . DIRECTORY_SEPARATOR . 'no-existe.db';
[$errno] = query($url, $missing, ['SELECT 1']);
check($errno === 2002 && !file_exists($missing), 'un archivo inexistente es un error y no se crea');
[$errno] = query($url, '', ['SELECT 1']);
check($errno === 2002, 'sin dbfile no abre una base temporal');
stop_server($proc);

echo "Directorio permitido\n";
$other = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'pyro_sqlite_outside_' . bin2hex(random_bytes(6)) . '.db';
copy($file, $other);
[$proc, $url] = start_server(['PYRO_TUNNEL_SQLITE_DIR' => $dir]);
[$errno] = query($url, $file, ['SELECT 1']);
check($errno === 0, 'permite archivos dentro de PYRO_TUNNEL_SQLITE_DIR');
[$errno] = query($url, $other, ['SELECT 1']);
check($errno === 2002, 'rechaza archivos fuera de PYRO_TUNNEL_SQLITE_DIR');
stop_server($proc);

@unlink($other);
@unlink($file);
@rmdir($dir);

echo "\n$total pruebas, $failures fallos\n";
exit($failures === 0 ? 0 : 1);
