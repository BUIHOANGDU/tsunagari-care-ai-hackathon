# Smart Home V2 Phase 6.8 Hardware Bring-up

Scope: compile/upload preparation and real hardware test checklist for the
existing Smart Home V2 firmware. This document does not change server,
Dashboard, Chami, Firebase, API, command format, device list, or IR behavior.

## Build Environment

Preferred build path: PlatformIO in the firmware directory:

```powershell
pio run -d TsunagariCare_SmartHome_Bridge_Demo
```

The firmware directory contains `platformio.ini` with the current Arduino ESP32
environment and library dependencies. If PlatformIO is not installed locally,
install PlatformIO or use the Arduino IDE/Arduino CLI with the same libraries.

## Required Libraries

Pinned in `TsunagariCare_SmartHome_Bridge_Demo/platformio.ini`:

| Library | Version |
| --- | --- |
| ArduinoJson | `^6.21.5` |
| IRremoteESP8266 | `^2.8.6` |
| Adafruit GFX Library | `^1.11.9` |
| Adafruit ILI9341 | `^1.6.1` |
| Adafruit BusIO | `^1.16.1` |
| Adafruit BME280 Library | `^2.2.4` |
| Adafruit Unified Sensor | `^1.1.14` |
| XPT2046_Touchscreen | `^1.4` |
| Adafruit NeoPixel | `^1.12.3` |

## Local Config Requirements

Do not print or commit Wi-Fi password, device token, private keys, or service
account files. Copy only the missing hardware macros from `config.example.h`
into local `config.h`.

Required hardware macros:

- `SMART_HOME_DEMO_MODE`
- `TFT_SCK_PIN`, `TFT_MOSI_PIN`, `TFT_MISO_PIN`, `TFT_CS_PIN`, `TFT_DC_PIN`,
  `TFT_RST_PIN`
- `TOUCH_CS_PIN`, `TOUCH_IRQ_PIN`, `TOUCH_MIN_X`, `TOUCH_MAX_X`,
  `TOUCH_MIN_Y`, `TOUCH_MAX_Y`, `TOUCH_SWAP_XY`, `TOUCH_INVERT_X`,
  `TOUCH_INVERT_Y`, `TOUCH_MIN_PRESSURE`, `TOUCH_DEBOUNCE_MS`,
  `SMART_HOME_TOUCH_DEBUG`
- `BME280_SDA_PIN`, `BME280_SCL_PIN`
- `DEMO_LIVING_LED_PIN`, `DEMO_BEDROOM_LED_PIN`, `DEMO_AC_LED_PIN`
- `SYSTEM_WS2812_PIN`, `SYSTEM_LED_BRIGHTNESS`, `SYSTEM_ACTIVITY_MS`
- `BUZZER_PIN`, `BUZZER_CONFIRM_MS`, `BUZZER_NAV_MS`,
  `BUZZER_ACTIVE_TYPE`, `BUZZER_PASSIVE_FREQUENCY`

## Wiring Checklist

| Part | Wiring |
| --- | --- |
| TFT ILI9341 SCK | GPIO18 |
| TFT ILI9341 MOSI/SDI | GPIO23 |
| TFT ILI9341 MISO/SDO | GPIO19 |
| TFT ILI9341 CS | GPIO5 |
| TFT ILI9341 DC | GPIO27 |
| TFT ILI9341 RST | GPIO14 |
| Touch T_CLK | GPIO18 |
| Touch T_DIN | GPIO23 |
| Touch T_DO | GPIO19 |
| Touch T_CS | GPIO32 |
| Touch T_IRQ | GPIO35 |
| BME280 SDA | GPIO21 |
| BME280 SCL | GPIO22 |
| Living LED | GPIO25 through 220-330 ohm resistor |
| Bedroom LED | GPIO26 through 220-330 ohm resistor |
| AC LED | GPIO13 through 220-330 ohm resistor |
| WS2812 DIN | GPIO4 |
| Buzzer signal | GPIO16 |
| IR TX | GPIO17 |
| IR RX | GPIO33 |
| Legacy LED | GPIO2 |

All modules must share common GND. Prefer 3.3 V for BME280. Confirm the TFT
module VCC and backlight requirements before powering the display. Do not use
relay, mains AC, or 100 V hardware for this demo.

## Startup Logs To Check

Open Serial Monitor at 115200 baud and confirm:

- `Feedback: WS2812 pin=...`
- `Feedback: buzzer pin=... activeType=...`
- `TFT: width=320 height=240`
- `Touch: XPT2046-compatible CS=... IRQ=...`
- `BME280: I2C SDA=... SCL=...`
- `BME280: detected at 0x76` or `0x77`, or `BME280: NOT FOUND`
- `IR receiver and sender started`
- `Smart Home demo mode: enabled` or `disabled`
- Wi-Fi `CONNECTING`, `CONNECTED`, `DISCONNECTED`, and server status logs

## Safe Hardware Test Order

1. ESP32 boot only with Serial Monitor.
2. TFT boot screen, 320x240 landscape, then HOME UI.
3. BME280 temperature, humidity, and pressure.
4. WS2812 boot dim cyan, offline red, online green.
5. Buzzer short confirmation beep.
6. Three demo LEDs: living, bedroom, AC.
7. Touch raw calibration.
8. Touch commands: living, bedroom, AC, AC temperature +/-, navigation.
9. Wi-Fi loss and reconnect.
10. Legacy IR receive/send.

Stop at the first failing test and isolate that peripheral before connecting or
testing the next one.

## Touch Calibration

1. In local `config.h`, set `SMART_HOME_TOUCH_DEBUG` to `1`.
2. Upload and open Serial Monitor at 115200 baud.
3. Tap top-left, top-right, bottom-left, bottom-right, and center.
4. Record `rawX`, `rawY`, mapped coordinates, and `z`.
5. Update local `TOUCH_MIN_X`, `TOUCH_MAX_X`, `TOUCH_MIN_Y`, `TOUCH_MAX_Y`.
6. If axes are swapped, set `TOUCH_SWAP_XY` to `1`.
7. If an axis is mirrored, adjust `TOUCH_INVERT_X` or `TOUCH_INVERT_Y`.
8. Set `SMART_HOME_TOUCH_DEBUG` back to `0` after calibration.

Do not guess final calibration values before measuring the actual panel.

## Demo Mode

For the three physical demo LEDs, set `SMART_HOME_DEMO_MODE` to `1` in local
`config.h` after wiring is verified. The legacy GPIO2 LED remains unchanged and
continues to mirror the living light for backward compatibility.

## WS2812 Verification

Current firmware uses one WS2812 pixel on GPIO4 with `NEO_GRB + NEO_KHZ800` and
brightness 48. If red/green/blue colors are wrong on hardware, evaluate
`NEO_RGB` later after the physical test; do not change the mapping before a
real color check.

## Buzzer Verification

Confirm the buzzer type by hardware test:

- Active buzzer: `BUZZER_ACTIVE_TYPE = 1`
- Passive buzzer: `BUZZER_ACTIVE_TYPE = 0`

The firmware uses non-blocking beep timers and keeps beeps short.

## SPI Conflict And GPIO5 Boot Risk

TFT and touch share SPI lines and use separate chip-select pins. Firmware sets
`TFT_CS_PIN` and `TOUCH_CS_PIN` HIGH during touch initialization and keeps TFT
CS HIGH before touch reads.

Required hardware checks:

- Confirm TFT CS GPIO5 is not pulled LOW by the display module during boot.
- Power cycle several times and confirm ESP32 boots consistently.
- Press reset several times and confirm ESP32 boots consistently.
- During touch tests, confirm TFT rendering remains stable.
- If SPI contention is suspected, verify that TFT CS and touch CS are not LOW
  at the same time.

GPIO5 is an ESP32 strapping pin, so do not change it in this phase, but treat
boot stability as mandatory evidence before Phase 7.

## Optional Peripheral Absence Tests

Firmware should not crash or reset-loop when:

- BME280 is missing.
- Internet is unavailable.
- Touch is not connected.
- WS2812 is not connected.

If a peripheral blocks during init on the actual module, capture the Serial log
and isolate that device before changing firmware behavior.
