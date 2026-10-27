<?php
/**
 * Pruebas unitarias (funciones puras) de la allowlist de hosts del túnel.
 *
 * Incluye pyro_tunnel.php en modo biblioteca (sin atender la petición) e
 * inyecta un resolvedor DNS falso. Uso: php tunnel/tests/tunnel_hosts_test.php
 */

declare(strict_types=1);

const PYRO_TUNNEL_LIB = true;
require __DIR__ . '/../pyro_tunnel.php';
error_reporting(E_ALL);
ini_set('display_errors', '1');

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

/** Resolvedor falso: nombre => lista de IPs. Lo no listado no resuelve. */
function fake_resolver(array $map): callable
{
    return function (string $name) use ($map): array {
        return $map[$name] ?? [];
    };
}

/** Evalúa un host contra una lista cruda (como vendría de la configuración). */
function decide(string $host, array $rawList, array $dns = [], bool $token = true): array
{
    [$entries] = pyro_parse_allowlist($rawList);
    return pyro_check_db_host($host, $token, $entries, fake_resolver($dns));
}

// ── Normalización ──────────────────────────────────────────────────────────
echo "Normalización de hosts\n";
$cases = [
    '127.1' => '127.0.0.1',
    '2130706433' => '127.0.0.1',
    '0x7f.1' => '127.0.0.1',
    '0x7F000001' => '127.0.0.1',
    '0177.0.0.1' => '127.0.0.1',
    '::ffff:127.0.0.1' => '127.0.0.1',
    '::FFFF:7f00:1' => '127.0.0.1',
    '[::1]' => '::1',
    '[0:0:0:0:0:0:0:1]' => '::1',
    'localhost.' => 'localhost',
    '  LocalHost  ' => 'localhost',
    'DB.MiEmpresa.COM.' => 'db.miempresa.com',
    '10.0.0.5' => '10.0.0.5',
];
foreach ($cases as $in => $expected) {
    $in = (string) $in;
    $got = pyro_normalize_db_host($in);
    check($got === $expected, "'$in' -> '$expected' (obtenido " . var_export($got, true) . ')');
}
$invalid = [
    'p:localhost', 'p:127.0.0.1', '', ' ', 'local host', 'host/path', 'a@b', "db\0.x", 'db;x',
    str_repeat('a', 254), str_repeat('a', 64) . '.com', '256.0.0.1', '1.2.3.4.5', '0x', '08.0.0.1',
    '[::1', '::1]', '..', 'a..b', '-a.com', 'a-.com', '*', '*.a.com', '[127.0.0.1]', '[db.com]',
];
foreach ($invalid as $in) {
    check(pyro_normalize_db_host($in) === null, 'rechaza ' . var_export(strlen($in) > 40 ? substr($in, 0, 20) . '…' : $in, true));
}
check(pyro_normalize_db_host(str_repeat('a', 63) . '.' . str_repeat('b', 63) . '.' . str_repeat('c', 63) . '.' . str_repeat('d', 61)) !== null, 'acepta 253 caracteres');

// ── Bloqueos fijos ─────────────────────────────────────────────────────────
echo "Bloqueos fijos\n";
foreach (['169.254.169.254', '169.254.0.1', '0.0.0.0', '0.1.2.3', '224.0.0.1', '239.255.255.250', 'fe80::1', 'febf::1', 'ff02::1', '::'] as $ip) {
    check(pyro_is_blocked_ip($ip), "$ip bloqueada");
}
foreach (['10.0.0.5', '172.16.0.1', '192.168.1.1', '127.0.0.1', '::1', 'fd00::1', '8.8.8.8', 'fec0::1'] as $ip) {
    check(!pyro_is_blocked_ip($ip), "$ip no bloqueada");
}

// ── Parseo de la allowlist ─────────────────────────────────────────────────
echo "Parseo de la allowlist\n";
[$entries, $errors] = pyro_parse_allowlist([]);
check(count($entries) === 3 && $errors === [], 'lista vacía = valor por defecto (3 entradas)');
[$entries, $errors] = pyro_parse_allowlist(['', '  ']);
check(count($entries) === 3 && $errors === [], 'lista de entradas vacías = valor por defecto');
foreach (['10.0.0.0/33', '10.0.0.0/-1', '10.0.0.0/', '10.0.0.0/8/8', 'fd00::/129', 'db.com/8', '10.0.0.0/08x', '*.', '*x.com', 'a.*.com', '**', '*.*.com', 'p:db', 'db com'] as $bad) {
    [$entries, $errors] = pyro_parse_allowlist([$bad]);
    check($entries === [] && count($errors) === 1, "entrada inválida '$bad' ignorada y registrada");
}
[$entries, $errors] = pyro_parse_allowlist(['10.0.0.0/33', 'db.com']);
check(count($entries) === 1 && count($errors) === 1, 'una entrada inválida no anula las válidas');
$r = decide('10.0.0.5', ['10.0.0.0/33']);
check(!$r['ok'] && $r['errno'] === 206, 'CIDR inválido nunca se interpreta como *');
$r = decide('db.com', ['*.']);
check(!$r['ok'] && $r['errno'] === 206, 'comodín inválido nunca se interpreta como *');

// ── Valor por defecto ──────────────────────────────────────────────────────
echo "Valor por defecto\n";
foreach (['localhost', '127.0.0.1', '::1', '[::1]', '127.1', '0x7f.1', '::ffff:127.0.0.1', 'LOCALHOST.'] as $h) {
    check(decide($h, [])['ok'], "$h permitido por defecto");
}
$r = decide('localhost', []);
check($r['target'] === 'localhost', 'localhost conserva su comportamiento (no se resuelve)');
foreach (['10.0.0.5', '127.0.0.2', 'db.miempresa.com'] as $h) {
    $r = decide($h, [], ['db.miempresa.com' => ['10.0.0.5']]);
    check(!$r['ok'] && $r['errno'] === 206, "$h rechazado por defecto");
}
$r = decide('p:localhost', []);
check(!$r['ok'] && $r['errno'] === 206, 'p:localhost (conexión persistente) rechazado');

// ── Lista explícita ────────────────────────────────────────────────────────
echo "Lista explícita\n";
$r = decide('localhost', ['db.miempresa.com']);
check(!$r['ok'] && $r['errno'] === 206, 'lista explícita sin localhost rechaza localhost');
$r = decide('127.0.0.1', ['db.miempresa.com']);
check(!$r['ok'], 'lista explícita sin localhost rechaza 127.0.0.1');
$r = decide('DB.MiEmpresa.com', ['db.miempresa.com'], ['db.miempresa.com' => ['10.0.0.5']]);
check($r['ok'] && $r['target'] === '10.0.0.5', 'host exacto insensible a mayúsculas, conecta a la IP validada');

// ── Comodines de subdominio ────────────────────────────────────────────────
echo "Comodines\n";
$dns = [
    'db.miempresa.com' => ['10.0.0.5'],
    'a.b.miempresa.com' => ['10.0.0.6'],
    'miempresa.com' => ['203.0.113.1'],
    'evilmiempresa.com' => ['203.0.113.2'],
    'miempresa.com.evil.net' => ['203.0.113.3'],
    'meta.miempresa.com' => ['169.254.169.254'],
    'mixto.miempresa.com' => ['10.0.0.7', '169.254.169.254'],
    'mapped.miempresa.com' => ['::ffff:169.254.169.254'],
];
check(decide('db.miempresa.com', ['*.miempresa.com'], $dns)['ok'], '*.miempresa.com admite db.miempresa.com');
check(decide('a.b.miempresa.com', ['*.miempresa.com'], $dns)['ok'], '*.miempresa.com admite subdominios anidados');
check(!decide('miempresa.com', ['*.miempresa.com'], $dns)['ok'], '*.miempresa.com NO admite el dominio raíz');
check(decide('miempresa.com', ['*.miempresa.com', 'miempresa.com'], $dns)['ok'], 'el dominio raíz se admite si se lista aparte');
check(!decide('evilmiempresa.com', ['*.miempresa.com'], $dns)['ok'], 'no coincide por sufijo sin punto');
check(!decide('miempresa.com.evil.net', ['*.miempresa.com'], $dns)['ok'], 'no coincide por prefijo');
check(!decide('meta.miempresa.com', ['*.miempresa.com'], $dns)['ok'], 'subdominio que resuelve a 169.254.169.254 rechazado');
check(!decide('mixto.miempresa.com', ['*.miempresa.com'], $dns)['ok'], 'basta una IP bloqueada entre varias para rechazar');
check(!decide('mapped.miempresa.com', ['*.miempresa.com'], $dns)['ok'], 'IPv4 mapeada bloqueada también se detecta');
$r = decide('noexiste.miempresa.com', ['*.miempresa.com'], $dns);
check(!$r['ok'] && $r['errno'] === 2005, 'nombre que no resuelve -> 2005');

// ── CIDR ───────────────────────────────────────────────────────────────────
echo "CIDR\n";
$dns = [
    'evil.com' => ['127.0.0.1'],
    'meta.evil.com' => ['169.254.169.254'],
    'interno.lan' => ['10.1.2.3'],
    'v6.lan' => ['fd00::10'],
    'mixto.lan' => ['10.1.2.3', '192.168.0.1'],
];
check(decide('10.200.0.1', ['10.0.0.0/8'])['ok'], '10.0.0.0/8 admite 10.200.0.1');
check(!decide('11.0.0.1', ['10.0.0.0/8'])['ok'], '10.0.0.0/8 rechaza 11.0.0.1');
check(decide('interno.lan', ['10.0.0.0/8'], $dns)['ok'], 'un nombre se admite si todas sus IPs caen en el CIDR');
check(!decide('mixto.lan', ['10.0.0.0/8'], $dns)['ok'], 'un nombre con alguna IP fuera del CIDR se rechaza');
check(decide('v6.lan', ['fd00::/8'], $dns)['ok'], 'fd00::/8 admite fd00::10 resuelto');
check(decide('[fd12::1]', ['fd00::/8'])['ok'], 'fd00::/8 admite [fd12::1]');
check(!decide('fe80::1', ['fe80::/10'])['ok'], 'fe80::/10 sigue bloqueado aunque se liste');
check(decide('10.0.0.5', ['10.0.0.5/32'])['ok'], '/32 admite la IP exacta');
check(!decide('10.0.0.6', ['10.0.0.5/32'])['ok'], '/32 rechaza la IP vecina');
check(decide('203.0.113.9', ['0.0.0.0/0'])['ok'], '/0 admite cualquier IPv4 pública');
check(!decide('169.254.169.254', ['0.0.0.0/0'])['ok'], '/0 no desbloquea 169.254.169.254');
check(!decide('0.0.0.0', ['0.0.0.0/0'])['ok'], '/0 no desbloquea 0.0.0.0');
check(!decide('::1', ['0.0.0.0/0'])['ok'], '/0 IPv4 no admite IPv6');
check(decide('2130706433', ['127.0.0.0/8'])['ok'], 'forma decimal normalizada antes del CIDR');
check(!decide('evil.com', ['10.0.0.0/8'], $dns)['ok'], 'evil.com -> 127.0.0.1 rechazado si 127/8 no está permitido');
check(!decide('meta.evil.com', ['0.0.0.0/0'], $dns)['ok'], 'meta.evil.com -> 169.254.169.254 rechazado incluso con /0');

// ── Comodín total ──────────────────────────────────────────────────────────
echo "Comodín *\n";
check(decide('db.cualquiera.net', ['*'], ['db.cualquiera.net' => ['198.51.100.7']])['ok'], '* admite cualquier nombre');
check(decide('192.168.1.10', ['*'])['ok'], '* admite redes privadas');
check(decide('localhost', ['*'])['ok'], '* admite localhost');
foreach (['169.254.169.254', '0.0.0.0', '224.0.0.1', 'fe80::1', 'ff02::1', '::ffff:169.254.169.254', '2852039166'] as $h) {
    check(!decide($h, ['*'])['ok'], "* sigue bloqueando $h");
}
$r = decide('evil.com', ['*'], ['evil.com' => ['169.254.169.254']]);
check(!$r['ok'] && $r['errno'] === 206, '* con evil.com -> 169.254.169.254 rechazado');
$r = decide('evil.com', ['*'], ['evil.com' => ['127.0.0.1']]);
check($r['ok'] && $r['target'] === '127.0.0.1', '* con evil.com -> 127.0.0.1 conecta a la IP validada');
$r = decide('db.cualquiera.net', ['*'], ['db.cualquiera.net' => ['198.51.100.7']], false);
check(!$r['ok'] && $r['errno'] === 212, '* sin token verificado -> 212');
$r = decide('localhost', [], [], false);
check(!$r['ok'] && $r['errno'] === 212, 'sin token verificado se rechaza cualquier host');

// ── Destino de conexión ────────────────────────────────────────────────────
echo "Destino de conexión\n";
$r = decide('dual.lan', ['*'], ['dual.lan' => ['fd00::5', '10.0.0.9']]);
check($r['ok'] && $r['target'] === '10.0.0.9', 'prefiere IPv4 entre las IPs validadas');
$r = decide('v6only.lan', ['*'], ['v6only.lan' => ['fd00::5']]);
check($r['ok'] && $r['target'] === 'fd00::5', 'usa IPv6 si es la única');
$r = decide('raro.lan', ['*'], ['raro.lan' => ['no-es-ip']]);
check(!$r['ok'], 'respuesta DNS no válida se rechaza');

echo "\n$total pruebas, $failures fallos\n";
exit($failures === 0 ? 0 : 1);
