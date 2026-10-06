param([string]$OutputRoot = 'presentation-toolkit-output', [switch]$DesignReview)

$ErrorActionPreference = 'Stop'
$taskOutputRoot = (Resolve-Path -LiteralPath $OutputRoot).Path
$taskPowerPoint = New-Object -ComObject PowerPoint.Application
$taskExistingDecks = $taskPowerPoint.Presentations.Count
$taskOriginalAlerts = $taskPowerPoint.DisplayAlerts
$taskPowerPoint.DisplayAlerts = 1
$taskAudits = @()
$taskSlideCount = 0
$taskDecks = if ($DesignReview) {
    foreach ($taskTemplate in @('venture_blueprint', 'aetheria_modern', 'executive', 'startup_pitch', 'academic', 'creative_portfolio', 'minimal_zen', 'tech_dark', 'corporate_gradient')) {
        [pscustomobject]@{ Path = Join-Path $taskOutputRoot "$taskTemplate/$taskTemplate.pptx"; Preview = Join-Path $taskOutputRoot "$taskTemplate/powerpoint-previews"; Label = $taskTemplate }
    }
} else {
    foreach ($taskCount in @(5, 10, 15)) {
        [pscustomobject]@{ Path = Join-Path $taskOutputRoot "$taskCount-slides/support-pilot-$taskCount.pptx"; Preview = Join-Path $taskOutputRoot "$taskCount-slides/powerpoint-previews"; Label = "$taskCount-slides" }
    }
}
try {
    foreach ($taskInfo in $taskDecks) {
        $taskDeckPath = $taskInfo.Path
        $taskPreviewPath = $taskInfo.Preview
        New-Item -ItemType Directory -Path $taskPreviewPath -Force | Out-Null
        $taskDeck = $null
        try {
            $taskDeck = $taskPowerPoint.Presentations.Open($taskDeckPath, -1, 0, 0)
            $taskSlideCount += $taskDeck.Slides.Count
            $taskDeck.Export($taskPreviewPath, 'PNG', 1920, 1080)
            foreach ($taskSlide in $taskDeck.Slides) {
                foreach ($taskShape in $taskSlide.Shapes) {
                    if ($taskShape.HasTextFrame -eq -1 -and $taskShape.TextFrame.HasText -eq -1) {
                        $taskText = $taskShape.TextFrame.TextRange
                        $taskExcessWidth = $taskText.BoundLeft + $taskText.BoundWidth - $taskShape.Left - $taskShape.Width
                        $taskExcessHeight = $taskText.BoundTop + $taskText.BoundHeight - $taskShape.Top - $taskShape.Height
                        if ($taskExcessWidth -gt 1 -or $taskExcessHeight -gt 1) {
                            $taskAudits += [pscustomobject]@{
                                deck_slides = $taskDeck.Slides.Count
                                template = $taskInfo.Label
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
    $taskReport = @{ slide_count = $taskSlideCount; overflow_count = $taskAudits.Count; issues = $taskAudits }
    $taskReport | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $taskOutputRoot 'powerpoint-audit.json') -Encoding UTF8
    if ($taskAudits.Count -gt 0) { throw "PowerPoint found $($taskAudits.Count) overflowing text boxes. See powerpoint-audit.json." }
} finally {
    $taskPowerPoint.DisplayAlerts = $taskOriginalAlerts
    if ($taskExistingDecks -eq 0 -and $taskPowerPoint.Presentations.Count -eq 0) {
        $taskPowerPoint.Quit()
    }
    [Runtime.InteropServices.Marshal]::ReleaseComObject($taskPowerPoint) | Out-Null
}
