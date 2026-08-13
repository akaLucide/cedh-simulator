[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$ForgeRoot,

    [int]$Games = 1,
    [long]$Seed = 1,
    [int]$TimeoutSeconds = 300
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot

# The Node harness validates approvals and substitutions, builds all four
# decks, compiles the displayless launcher, and runs one Java process per game.
# Process isolation is required because Forge's in-process timeout can leave a
# game thread alive and contaminate the next simulated game.
& node (Join-Path $projectRoot 'scripts/run-forge-baseline.mjs') `
    --forge-root $ForgeRoot `
    --games $Games `
    --seed $Seed `
    --timeout $TimeoutSeconds `
    --headless `
    --quiet

exit $LASTEXITCODE
