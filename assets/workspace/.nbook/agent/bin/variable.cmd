@echo off
set "SCRIPT_DIR=%~dp0"
for %%I in ("%SCRIPT_DIR%..\..\..\..\..") do set "PRODUCT_ROOT=%%~fI"
set "PRODUCT_VARIABLE_SCRIPT=%PRODUCT_ROOT%\.output\server\scripts\build\variable.ts"
set "PRODUCT_TSX=%PRODUCT_ROOT%\.output\server\node_modules\tsx\dist\cli.mjs"
set "PORTABLE_NODE=%PRODUCT_ROOT%\..\runtime\node\node.exe"

if exist "%PRODUCT_VARIABLE_SCRIPT%" (
    if not exist "%PRODUCT_TSX%" (
        echo NeuroBook product runtime is missing .output\server\node_modules\tsx.
        exit /b 1
    )
    if exist "%PORTABLE_NODE%" (
        "%PORTABLE_NODE%" "%PRODUCT_TSX%" "%PRODUCT_VARIABLE_SCRIPT%" %*
        exit /b %ERRORLEVEL%
    )
    node "%PRODUCT_TSX%" "%PRODUCT_VARIABLE_SCRIPT%" %*
    exit /b %ERRORLEVEL%
) else (
    call bun "%SCRIPT_DIR%..\scripts\variable.ts" %*
    exit /b %ERRORLEVEL%
)
