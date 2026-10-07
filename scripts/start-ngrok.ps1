# Script para iniciar ngrok automáticamente
# Ejecuta: .\scripts\start-ngrok.ps1

Write-Host "🚀 Iniciando ngrok para localhost:4000..." -ForegroundColor Green
Write-Host ""
Write-Host "⚠️  Si ngrok no está instalado, ejecuta:" -ForegroundColor Yellow
Write-Host "       winget install ngrok" -ForegroundColor White
Write-Host ""
Write-Host "Si necesitas autenticación, ejecuta:" -ForegroundColor Yellow
Write-Host "       ngrok config add-authtoken TU_TOKEN_AQUI" -ForegroundColor White
Write-Host ""

ngrok http 4000 --region=us
