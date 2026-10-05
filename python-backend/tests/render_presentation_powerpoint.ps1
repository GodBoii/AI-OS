param([string]$OutputRoot = 'presentation-toolkit-output')

$ErrorActionPreference = 'Stop'
$taskOutputRoot = (Resolve-Path -LiteralPath $OutputRoot).Path
$taskPowerPoint = New-Object -ComObject PowerPoint.Application
$taskExistingDecks = $taskPowerPoint.Presentations.Count
$taskOriginalAlerts = $taskPowerPoint.DisplayAlerts
$taskPowerPoint.DisplayAlerts = 1
$taskAudits = @()
try {
    foreach ($taskCount in @(5, 10, 15)) {
        $taskDeckPath = Join-Path $taskOutputRoot "$taskCount-slides/support-pilot-$taskCount.pptx"
        $taskPreviewPath = Join-Path $taskOutputRoot "$taskCount-slides/powerpoint-previews"
        New-Item -ItemType Directory -Path $taskPreviewPath -Force | Out-Null
        $taskDeck = $null
        try {
            $taskDeck = $taskPowerPoint.Presentations.Open($taskDeckPath, -1, 0, 0)
            $taskDeck.Export($taskPreviewPath, 'PNG', 1920, 1080)
            foreach ($taskSlide in $taskDeck.Slides) {
                foreach ($taskShape in $taskSlide.Shapes) {
                    if ($taskShape.HasTextFrame -eq -1 -and $taskShape.TextFrame.HasText -eq -1) {
                        $taskText = $taskShape.TextFrame.TextRange
                        $taskExcessWidth = $taskText.BoundLeft + $taskText.BoundWidth - $taskShape.Left - $taskShape.Width
                        $taskExcessHeight = $taskText.BoundTop + $taskText.BoundHeight - $taskShape.Top - $taskShape.Height
                        if ($taskExcessWidth -gt 1 -or $taskExcessHeight -gt 1) {
                            $taskAudits += [pscustomobject]@{
                                deck_slides = $taskCount
                                slide = $taskSlide.SlideIndex
                                text = $taskText.Text
                                excess_width_pt = $taskExcessWidth
                                excess_height_pt = $taskExcessHeight
                            }
                        }
                    }
                }
            }
            Write-Output "PowerPoint rendered and audited $($taskDeck.Slides.Count) slides into $taskPreviewPath"
        } finally {
            if ($null -ne $taskDeck) {
                $taskDeck.Close()
                [Runtime.InteropServices.Marshal]::ReleaseComObject($taskDeck) | Out-Null
            }
        }
    }
    $taskReport = @{ slide_count = 30; overflow_count = $taskAudits.Count; issues = $taskAudits }
    $taskReport | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $taskOutputRoot 'powerpoint-audit.json') -Encoding UTF8
    if ($taskAudits.Count -gt 0) { throw "PowerPoint found $($taskAudits.Count) overflowing text boxes. See powerpoint-audit.json." }
} finally {
    $taskPowerPoint.DisplayAlerts = $taskOriginalAlerts
    if ($taskExistingDecks -eq 0 -and $taskPowerPoint.Presentations.Count -eq 0) {
        $taskPowerPoint.Quit()
    }
    [Runtime.InteropServices.Marshal]::ReleaseComObject($taskPowerPoint) | Out-Null
}
