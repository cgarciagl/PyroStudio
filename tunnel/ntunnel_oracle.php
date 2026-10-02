<?php
$versionNum = 200; // Navicat HTTP Tunnel for Oracle (OCI8)

// Set allowTestMenu to false to disable System/Server test page
$allowTestMenu = true;

header("Content-Type: text/plain; charset=x-user-defined");
error_reporting(0);
set_time_limit(0);

function phpversion_int()
{
	list($maVer, $miVer, $edVer) = preg_split("(/|\.|-)", phpversion());
	return $maVer*10000 + $miVer*100 + $edVer;
}

if (phpversion_int() < 50300)
{
	set_magic_quotes_runtime(0);
}

function GetLongBinary($num)
{
	return pack("N", $num);
}

function GetShortBinary($num)
{
	return pack("n", $num);
}

function GetDummy($count)
{
	$str = "";
	for ($i = 0; $i < $count; $i++)
		$str .= "\x00";
	return $str;
}

function GetBlock($val)
{
	$len = strlen($val);
	if ($len < 254)
		return chr($len) . $val;
	else
		return "\xFE" . GetLongBinary($len) . $val;
}

function EchoHeader($errno)
{
	global $versionNum;

	$str = GetLongBinary(1111);
	$str .= GetShortBinary($versionNum);
	$str .= GetLongBinary($errno);
	$str .= GetDummy(6);
	echo $str;
}

function EchoConnInfo($conn)
{
	$host = isset($_POST["host"]) ? $_POST["host"] : "";
	$str = GetBlock($host);
	$str .= GetBlock("OCI8");
	$server = @oci_server_version($conn);
	$str .= GetBlock($server ? $server : "Oracle Database");
	echo $str;
}

function EchoResultSetHeader($errno, $affectrows, $insertid, $numfields, $numrows)
{
	$str = GetLongBinary($errno);
	$str .= GetLongBinary($affectrows);
	$str .= GetLongBinary($insertid);
	$str .= GetLongBinary($numfields);
	$str .= GetLongBinary($numrows);
	$str .= GetDummy(12);
	echo $str;
}

function EchoFieldsHeader($stmt, $numfields)
{
	$str = "";
	for ($i = 1; $i <= $numfields; $i++) {
		$str .= GetBlock(oci_field_name($stmt, $i));
		$str .= GetBlock(""); // Table name empty

		$typeStr = strtolower(oci_field_type($stmt, $i));
		$length = oci_field_size($stmt, $i);

		switch ($typeStr) {
			case "number":
				$type = 2;
				break;
			case "varchar":
			case "varchar2":
			case "nvarchar2":
				$type = 253;
				break;
			case "char":
			case "nchar":
				$type = 254;
				break;
			case "date":
				$type = 12;
				break;
			case "timestamp":
			case "timestamp with time zone":
			case "timestamp with local time zone":
				$type = 180;
				break;
			case "float":
			case "binary_float":
				$type = 4;
				break;
			case "binary_double":
				$type = 5;
				break;
			case "clob":
			case "nclob":
			case "blob":
			case "raw":
			case "long":
				$type = 252;
				break;
			default:
				$type = 253;
				break;
		}

		$str .= GetLongBinary($type);
		$str .= GetLongBinary(0); // flags
		$str .= GetLongBinary($length);
	}
	echo $str;
}

function EchoData($rows, $numfields, $numrows)
{
	for ($i = 0; $i < $numrows; $i++) {
		$str = "";
		$row = $rows[$i];
		for ($j = 0; $j < $numfields; $j++) {
			if (is_null($row[$j]))
				$str .= "\xFF";
			else
				$str .= GetBlock((string)$row[$j]);
		}
		echo $str;
	}
}

if (phpversion_int() < 40005) {
	EchoHeader(201);
	echo GetBlock("unsupported php version");
	exit();
}

if (phpversion_int() < 40010) {
	global $HTTP_POST_VARS;
	$_POST = &$HTTP_POST_VARS;
}

$testMenu = false;
if (!isset($_POST["actn"]) || !isset($_POST["host"]) || !isset($_POST["login"])) {
	$testMenu = $allowTestMenu;
	if (!$testMenu) {
		EchoHeader(202);
		echo GetBlock("invalid parameters");
		exit();
	}
}

if (!$testMenu) {
	if (isset($_POST["encodeBase64"]) && $_POST["encodeBase64"] == '1') {
		for ($i = 0; $i < count($_POST["q"]); $i++)
			$_POST["q"][$i] = base64_decode($_POST["q"][$i]);
	}

	if (!function_exists("oci_connect")) {
		EchoHeader(203);
		echo GetBlock("Oracle OCI8 extension not supported on the server");
		exit();
	}

	$host = $_POST["host"];
	$port = (isset($_POST["port"]) && $_POST["port"] != "") ? $_POST["port"] : "1521";
	$db = isset($_POST["db"]) ? $_POST["db"] : "";
	$login = $_POST["login"];
	$password = isset($_POST["password"]) ? $_POST["password"] : "";

	if ($host != "") {
		if ($db != "") {
			$connstr = "//" . $host . ":" . $port . "/" . $db;
		} else {
			$connstr = "//" . $host . ":" . $port;
		}
	} else {
		$connstr = $db;
	}

	$errno_c = 0;
	$conn = @oci_connect($login, $password, $connstr, 'AL32UTF8');
	if (!$conn) {
		$alt_connstr = $host . ":" . $port . ($db != "" ? "/" . $db : "");
		$conn = @oci_connect($login, $password, $alt_connstr, 'AL32UTF8');
	}

	if (!$conn) {
		$e = oci_error();
		$errno_c = 202;
		$error_c = (is_array($e) && isset($e['message'])) ? $e['message'] : "Could not connect to Oracle server";
	}

	EchoHeader($errno_c);
	if ($errno_c > 0) {
		echo GetBlock($error_c);
	} elseif ($_POST["actn"] == "C") {
		EchoConnInfo($conn);
	} elseif ($_POST["actn"] == "Q") {
		for ($i = 0; $i < count($_POST["q"]); $i++) {
			$query = $_POST["q"][$i];
			if ($query == "") continue;
			if (phpversion_int() < 50400) {
				if (function_exists("get_magic_quotes_gpc") && get_magic_quotes_gpc())
					$query = stripslashes($query);
			}

			$stmt = @oci_parse($conn, $query);
			if (!$stmt) {
				$e = oci_error($conn);
				$err_msg = (is_array($e) && isset($e['message'])) ? $e['message'] : "SQL parse error";
				EchoResultSetHeader(1, 0, 0, 0, 0);
				echo GetBlock($err_msg);
			} else {
				$r = @oci_execute($stmt, OCI_COMMIT_ON_SUCCESS);
				if (!$r) {
					$e = oci_error($stmt);
					$err_msg = (is_array($e) && isset($e['message'])) ? $e['message'] : "SQL execution error";
					EchoResultSetHeader(1, 0, 0, 0, 0);
					echo GetBlock($err_msg);
				} else {
					$numfields = @oci_num_fields($stmt);
					$st_type = @oci_statement_type($stmt);

					if ($numfields > 0 && $st_type == "SELECT") {
						$rows = array();
						while ($row = @oci_fetch_array($stmt, OCI_NUM + OCI_RETURN_NULLS + OCI_RETURN_LOBS)) {
							$rows[] = $row;
						}
						$numrows = count($rows);
						$affectedrows = $numrows;

						EchoResultSetHeader(0, $affectedrows, 0, $numfields, $numrows);
						EchoFieldsHeader($stmt, $numfields);
						EchoData($rows, $numfields, $numrows);
					} else {
						$affectedrows = @oci_num_rows($stmt);
						EchoResultSetHeader(0, $affectedrows, 0, 0, 0);
						echo GetBlock("");
					}
				}
				@oci_free_statement($stmt);
			}

			if ($i < (count($_POST["q"]) - 1))
				echo "\x01";
			else
				echo "\x00";
		}
	}
	if ($conn) {
		oci_close($conn);
	}
	exit();
}

function doSystemTest()
{
	global $versionNum;

	function output($description, $succ, $resStr) {
		echo "<tr><td class=\"TestDesc\">$description</td><td ";
		echo ($succ)? "class=\"TestSucc\">$resStr[0]</td></tr>" : "class=\"TestFail\">$resStr[1]</td></tr>";
	}
	output("PHP version >= 4.0.5", phpversion_int() >= 40005, array("Yes (".phpversion().")", "No (".phpversion().")"));
	output("oci_connect() available", function_exists("oci_connect"), array("Yes", "No"));
	if (phpversion_int() >= 40302 && isset($_SERVER["SERVER_SOFTWARE"]) && substr($_SERVER["SERVER_SOFTWARE"], 0, 6) == "Apache" && function_exists("apache_get_modules")){
		if (in_array("mod_security2", apache_get_modules()))
			output("Mod Security 2 installed", false, array("No", "Yes"));
	}
	output("Current tunnel file version", true, array((int)($versionNum / 100) .".". ($versionNum % 100), ""));
}

header("Content-Type: text/html");
?>
<!DOCTYPE html PUBLIC "-//W3C//DTD HTML 4.01 Transitional//EN" "http://www.w3.org/TR/html4/loose.dtd">
<html>
<head>
	<title>Navicat HTTP Tunnel Tester (Oracle)</title>
	<meta http-equiv="Content-Type" content="text/html; charset=ISO-8859-1">
	<style type="text/css">
		body{
			margin: 30px;
			font-family: Tahoma;
			font-weight: normal;
			font-size: 14px;
			color: #222222;
		}
		table{
			width: 100%;
			border: 0px;
		}
		input{
			font-family:Tahoma,sans-serif;
			border-style:solid;
			border-color:#666666;
			border-width:1px;
		}
		fieldset{
			border-style:solid;
			border-color:#666666;
			border-width:1px;
		}
		.Title1{
			font-size: 30px;
			color: #003366;
		}
		.Title2{
			font-size: 10px;
			color: #999966;
		}
		.TestDesc{
			width:70%
		}
		.TestSucc{
			color: #00BB00;
		}
		.TestFail{
			color: #DD0000;
		}
		#page{
			max-width: 42em;
			min-width: 36em;
			border-width: 0px;
			margin: auto auto;
		}
		#host{
			width: 300px;
		}
		#port{
			width: 75px;
		}
		#login, #password, #db{
			width: 150px;
		}
		#Copyright{
			text-align: right;
			font-size: 10px;
			color: #888888;
		}
	</style>
	<script type="text/javascript">
	function getInternetExplorerVersion(){
		var ver = -1;
		if (navigator.appName == "Microsoft Internet Explorer"){
			var regex = new RegExp("MSIE ([0-9]{1,}[\.0-9]{0,})");
			if (regex.exec(navigator.userAgent))
				ver = parseFloat(RegExp.$1);
		}
		return ver;
	}
	function setText(element, text, succ){
		element.className = (succ)?"TestSucc":"TestFail";
		element.innerHTML = text;
	}
	function getByteAt(str, offset){
		return str.charCodeAt(offset) & 0xff;
	}
	function getIntAt(binStr, offset){
		return (getByteAt(binStr, offset) << 24)+
			(getByteAt(binStr, offset+1) << 16)+
			(getByteAt(binStr, offset+2) << 8)+
			(getByteAt(binStr, offset+3) >>> 0);
	}
	function getBlockStr(binStr, offset){
		if (getByteAt(binStr, offset) < 254)
			return binStr.substring(offset+1, offset+1+binStr.charCodeAt(offset));
		else
			return binStr.substring(offset+5, offset+5+getIntAt(binStr, offset+1));
	}
	function doServerTest(){
		var version = getInternetExplorerVersion();
		if (version==-1 || version>=9.0){
			var xmlhttp = (window.XMLHttpRequest)? new XMLHttpRequest() : xmlhttp=new ActiveXObject("Microsoft.XMLHTTP");
			
			xmlhttp.onreadystatechange=function(){
				var outputDiv = document.getElementById("ServerTest");
				if (xmlhttp.readyState == 4){
					if (xmlhttp.status == 200){
						var errno = getIntAt(xmlhttp.responseText, 6);
						if (errno == 0)
							setText(outputDiv, "Connection Success!", true);
						else
							setText(outputDiv, parseInt(errno)+" - "+getBlockStr(xmlhttp.responseText, 16), false);
					}else
						setText(outputDiv, "HTTP Error - "+xmlhttp.status, false);
				}
			}
			
			var params = "";
			var form = document.getElementById("TestServerForm");
			for (var i=0; i<form.elements.length; i++){
				if (i>0) params += "&";
				params += form.elements[i].id+"="+form.elements[i].value.replace("&", "%26");
			}
			
			document.getElementById("ServerTest").className = "";
			document.getElementById("ServerTest").innerHTML = "Connecting...";
			xmlhttp.open("POST", "", true);
			xmlhttp.setRequestHeader("Content-type", "application/x-www-form-urlencoded");
			xmlhttp.setRequestHeader("Content-length", params.length);
			xmlhttp.setRequestHeader("Connection", "close");
			xmlhttp.send(params);
		}else{
			document.getElementById("ServerTest").className = "";
			document.getElementById("ServerTest").innerHTML = "Internet Explorer "+version+" is not supported, please use Internet explorer 9.0 or above, firefox, chrome or safari";
		}
	}
	</script>
</head>

<body>
<div id="page">
<p>
	<font class="Title1">Navicat&trade;</font><br>
	<font class="Title2">The gateway to your Oracle database!</font>
</p>
<fieldset>
	<legend>System Environment Test</legend>
	<table>
		<tr style="<?php echo "display:none"; ?>"><td width=70%>PHP installed properly</td><td class="TestFail">No</td></tr>
		<?php echo doSystemTest();?>
	</table>
</fieldset>
<br>
<fieldset>
	<legend>Server Test</legend>
	<form id="TestServerForm" action="#" onSubmit="return false;">
	<input type=hidden id="actn" value="C">
	<table>
		<tr><td width="35%">Hostname/IP Address:</td><td><input type=text id="host" placeholder="localhost"></td></tr>
		<tr><td>Port:</td><td><input type=text id="port" placeholder="1521"></td></tr>
		<tr><td>Service Name / SID:</td><td><input type=text id="db" placeholder="ORCL / XE"></td></tr>
		<tr><td>Username:</td><td><input type=text id="login" placeholder="system"></td></tr>
		<tr><td>Password:</td><td><input type=password id="password" placeholder=""></td></tr>
		<tr><td></td><td><br><input id="TestButton" type="submit" value="Test Connection" onClick="doServerTest()"></td></tr>
	</table>
	</form>
	<div id="ServerTest"><br></div>
</fieldset>
<p id="Copyright">Copyright &copy; PremiumSoft &trade; CyberTech Ltd. All Rights Reserved.</p>
</div>
</body>
</html>
