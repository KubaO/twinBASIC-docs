param($path)
$bytes = [System.IO.File]::ReadAllBytes($path)
$pos = 0
function ReadU32 { $v = [BitConverter]::ToUInt32($bytes, $script:pos); $script:pos += 4; $v }
function ReadU16 { $v = [BitConverter]::ToUInt16($bytes, $script:pos); $script:pos += 2; $v }
function ReadI16 { $v = [BitConverter]::ToInt16($bytes, $script:pos); $script:pos += 2; $v }
function ReadU8  { $v = $bytes[$script:pos]; $script:pos += 1; $v }
function ReadStr { $len = ReadU32; if ($len -gt 0) { $s = [System.Text.Encoding]::UTF8.GetString($bytes, $script:pos, $len); $script:pos += $len; $s } else { "" } }
$entryCount = 0
function ReadEntry($indent) {
    $off = $script:pos
    $kind = ReadI16
    $name = ReadStr
    $mark1 = ReadU16
    $pad = $bytes[$script:pos..($script:pos+9)]; $script:pos += 10
    $mark2 = ReadU8
    $script:entryCount++
    $prefix = "  " * $indent
    if ($kind -eq 1 -and $script:entryCount -gt 1) {
        $contentLen = ReadU32
        $script:pos += $contentLen
        $trailer = ReadU32
        "{0}FILE  kind={1} mark1=0x{2:X4} mark2=0x{3:X2} name=""{4}"" contentLen={5} trailer=0x{6:X8} @0x{7:X}" -f $prefix,$kind,$mark1,$mark2,$name,$contentLen,$trailer,$off
    } else {
        $count = ReadU32
        "{0}DIR   kind={1} mark1=0x{2:X4} mark2=0x{3:X2} name=""{4}"" children={5} @0x{6:X}" -f $prefix,$kind,$mark1,$mark2,$name,$count,$off
        for ($i = 0; $i -lt $count; $i++) { ReadEntry ($indent+1) }
    }
}
$magic = ReadU32
"Magic: 0x{0:X8}" -f $magic
"File: $(Split-Path $path -Leaf) ($($bytes.Length) bytes)"
""
ReadEntry 0
