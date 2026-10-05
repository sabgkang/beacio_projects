# Beacio

PlatformIO projects using the Arduino framework.

## Projects

- `01-Test/`: ESP32-S3 development project targeting `esp32-s3-devkitc-1`, configured for 16 MB flash, 8 MB OPI PSRAM, and a serial monitor at 115200 baud.

Each project has its own `platformio.ini` with board, framework, dependency, and build settings.

## Getting started

Install PlatformIO Core or the PlatformIO IDE extension for Visual Studio Code. Open the project folder containing `platformio.ini` (currently `01-Test/`).

From the repository root, run:

```sh
# Build firmware
pio run --project-dir 01-Test

# Upload firmware to a connected board
pio run --project-dir 01-Test --target upload

# Open the serial monitor
pio device monitor --project-dir 01-Test
```

If multiple serial devices are connected, specify the port with `--upload-port` for upload or `--port` for the monitor.

## Project layout

```text
01-Test/
  platformio.ini  Board and build configuration
  src/           Application source code
  include/       Project headers
  lib/           Project-local libraries
  test/          Tests
```

Commit source files, `platformio.ini`, and project-local libraries. Generated build output, downloaded PlatformIO dependencies, and local editor state are excluded by `.gitignore`.
