[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$InputDeck,

    [Parameter(Mandatory = $true)]
    [string[]]$Commander,

    [Parameter(Mandatory = $true)]
    [string]$OutputDeck,

    [switch]$UseDigitalStickerSubstitute
)

$ErrorActionPreference = 'Stop'

function Get-FrontFaceName {
    param([string]$DeckLine)

    if ($DeckLine -notmatch '^\s*(\d+)\s+(.+?)\s*$') {
        throw "Unrecognized deck line: $DeckLine"
    }

    $quantity = [int]$Matches[1]
    $name = $Matches[2] -replace '\s+\([A-Z0-9]+\)\s+.*$', ''
    $name = ($name -split '\s+/\s+', 2)[0].Trim()

    if ($name -eq '_____ Goblin') {
        if (-not $UseDigitalStickerSubstitute) {
            throw 'Forge does not implement paper _____ Goblin. Re-run with ' +
                  '-UseDigitalStickerSubstitute only after explicitly accepting ' +
                  'the temporary "Name Sticker" Goblin behavior.'
        }
        $name = '"Name Sticker" Goblin'
    }

    [pscustomobject]@{ Quantity = $quantity; Name = $name }
}

$resolvedInput = (Resolve-Path -LiteralPath $InputDeck).Path
$cards = @(
    Get-Content -LiteralPath $resolvedInput |
        Where-Object { $_.Trim() -and -not $_.TrimStart().StartsWith('#') } |
        ForEach-Object { Get-FrontFaceName $_ }
)

$total = ($cards | Measure-Object -Property Quantity -Sum).Sum
if ($total -ne 100) {
    throw "Expected 100 cards, found $total in $resolvedInput"
}

$normalizedCommanders = @($Commander | ForEach-Object {
    (($_ -split '\s+/\s+', 2)[0]).Trim()
})

foreach ($commanderName in $normalizedCommanders) {
    $matches = @($cards | Where-Object Name -eq $commanderName)
    if ($matches.Count -ne 1 -or $matches[0].Quantity -ne 1) {
        throw "Commander '$commanderName' must appear exactly once in the input"
    }
}

$main = @($cards | Where-Object { $normalizedCommanders -notcontains $_.Name })
$deckName = [IO.Path]::GetFileNameWithoutExtension($OutputDeck)
$lines = [Collections.Generic.List[string]]::new()
$lines.Add('[metadata]')
$lines.Add("Name=$deckName")
$lines.Add('[Commander]')
foreach ($commanderName in $normalizedCommanders) {
    $lines.Add("1 $commanderName")
}
$lines.Add('[Main]')
foreach ($card in $main) {
    $lines.Add("$($card.Quantity) $($card.Name)")
}

$outputDirectory = Split-Path -Parent $OutputDeck
if ($outputDirectory) {
    New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null
}
[IO.File]::WriteAllLines($OutputDeck, $lines, [Text.UTF8Encoding]::new($false))

Write-Host "Wrote $total cards to $OutputDeck"

