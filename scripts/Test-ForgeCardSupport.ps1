[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$ForgeRoot,

    [Parameter(Mandatory = $true)]
    [string[]]$Deck
)

$ErrorActionPreference = 'Stop'
$cardsFolder = Join-Path $ForgeRoot 'forge-gui/res/cardsfolder'
if (-not (Test-Path -LiteralPath $cardsFolder -PathType Container)) {
    throw "Forge card scripts were not found at $cardsFolder"
}

$knownNames = [Collections.Generic.HashSet[string]]::new(
    [StringComparer]::Ordinal
)
Get-ChildItem -LiteralPath $cardsFolder -Recurse -Filter '*.txt' |
    ForEach-Object {
        Get-Content -LiteralPath $_.FullName |
            Where-Object { $_.StartsWith('Name:') } |
            ForEach-Object { [void]$knownNames.Add($_.Substring(5)) }
    }

$failed = $false
foreach ($deckPath in $Deck) {
    $resolvedDeck = (Resolve-Path -LiteralPath $deckPath).Path
    $names = @(
        Get-Content -LiteralPath $resolvedDeck |
            Where-Object { $_.Trim() -and -not $_.TrimStart().StartsWith('#') } |
            ForEach-Object {
                if ($_ -notmatch '^\s*\d+\s+(.+?)\s*$') {
                    throw "Unrecognized deck line in ${resolvedDeck}: $_"
                }
                $name = $Matches[1] -replace '\s+\([A-Z0-9]+\)\s+.*$', ''
                (($name -split '\s+/\s+', 2)[0]).Trim()
            }
    )

    $missing = @($names | Where-Object { -not $knownNames.Contains($_) })
    $found = $names.Count - $missing.Count
    Write-Host "$resolvedDeck : $found/$($names.Count) exact front-face names found"
    foreach ($name in $missing) {
        Write-Host "  MISSING: $name"
    }
    if ($missing.Count -gt 0) { $failed = $true }
}

if ($failed) { exit 1 }

