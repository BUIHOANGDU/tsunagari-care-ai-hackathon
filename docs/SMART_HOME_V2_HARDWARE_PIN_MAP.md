# Smart Home V2 Phase 3.5 Hardware Master Pin Map

Board: Freenove ESP32 WROOM

This map preserves the current legacy firmware pins and reserves the Phase 4+
hardware pins without implementing TFT, touch, BME280, WS2812, buzzer, button,
microSD, dashboard, server, Firebase, Chami, or IR behavior changes.

## Final Pin Map

| GPIO | Function | Direction | Bus | Notes |
| --- | --- | --- | --- | --- |
| 2 | Legacy LED_PIN | Output | GPIO | USED. Preserved from current firmware. ESP32 strapping pin; keep load light and do not force an unsafe boot level. |
| 4 | SYSTEM_WS2812_PIN | Output | One-wire LED data | USED. Selected for single WS2812 data. Output-capable and not a flash pin on ESP32 WROOM. |
| 5 | TFT_CS_PIN | Output | Shared SPI chip select | USED. ESP32 strapping pin; acceptable only if TFT CS is not held low during boot. Prefer pull-up/high idle. |
| 13 | DEMO_AC_LED_PIN | Output | GPIO | USED. Output-capable. Also JTAG/ADC2-capable; no ADC use planned. |
| 14 | TFT_RST_PIN | Output | GPIO | USED. Output-capable. Also JTAG/HSPI-capable; no JTAG use planned. |
| 16 | BUZZER_PIN | Output | GPIO/PWM | USED. Selected for buzzer. Safe on ESP32 WROOM; avoid this map on ESP32 WROVER modules that use PSRAM pins. |
| 17 | IR_SEND_PIN | Output | GPIO/IR TX | USED. Preserved from current firmware. Safe on ESP32 WROOM. |
| 18 | TFT_SCK_PIN | Output | Shared SPI SCK | USED. Shared by TFT SCK and touch T_CLK. |
| 19 | TFT_MISO_PIN | Input | Shared SPI MISO | USED. Shared by TFT SDO/MISO and touch T_DO. |
| 21 | BME280_SDA_PIN | Bidirectional | I2C SDA | USED. Independent I2C bus for BME280. |
| 22 | BME280_SCL_PIN | Output | I2C SCL | USED. Independent I2C bus for BME280. |
| 23 | TFT_MOSI_PIN | Output | Shared SPI MOSI | USED. Shared by TFT SDI/MOSI and touch T_DIN. |
| 25 | DEMO_LIVING_LED_PIN | Output | GPIO | USED. Output-capable demo LED. |
| 26 | DEMO_BEDROOM_LED_PIN | Output | GPIO | USED. Output-capable demo LED. |
| 27 | TFT_DC_PIN | Output | GPIO | USED. TFT data/command. |
| 32 | TOUCH_CS_PIN | Output | Shared SPI chip select | USED. Touch CS, separate from TFT CS. |
| 33 | IR_RECEIVE_PIN | Input | GPIO/IR RX | USED. Preserved from current firmware. |
| 35 | TOUCH_IRQ_PIN | Input | GPIO interrupt | USED. Input-only, valid for IRQ. Requires module/external pull-up because GPIO34-39 do not provide software pull-up/down. |

## Shared SPI

TFT and touch share the same SPI signal lines and use separate chip selects:

| Signal | GPIO |
| --- | --- |
| TFT SCK + Touch T_CLK | 18 |
| TFT MOSI/SDI + Touch T_DIN | 23 |
| TFT MISO/SDO + Touch T_DO | 19 |
| TFT CS | 5 |
| Touch CS | 32 |
| Touch IRQ | 35 |

The microSD pins on the display module are intentionally unused in this phase.

## BME280

The BME280 is reserved for I2C only:

| Signal | GPIO |
| --- | --- |
| SDA | 21 |
| SCL | 22 |

Wire the BME280 breakout for I2C mode according to its module documentation.
CSB and SDO do not need ESP32 GPIO assignments in this phase.

## TFT Backlight

No GPIO is reserved for TFT backlight in Phase 3.5. Prefer wiring the TFT LED
backlight pin to the module-supported power rail for always-on backlight if the
specific module allows it safely. Add a PWM backlight pin later only if the
actual module requires brightness control.

## Power And Wiring Notes

- ESP32 GPIO logic is 3.3 V.
- Prefer powering the BME280 breakout from 3.3 V when the module supports it.
- Each 5 mm demo LED must use a series resistor, typically 220-330 ohm.
- WS2812 power should match the breakout requirements; feed DIN from the ESP32
  GPIO and use common GND.
- Confirm the TFT module VCC requirement before wiring 3.3 V or 5 V.
- All modules must share common GND.
- Do not use relay, mains AC, or 100 V hardware for this demo pin map.

## Validation Notes

- No GPIO is duplicated.
- No output is assigned to GPIO34-GPIO39.
- GPIO6-GPIO11 flash pins are unused.
- Existing GPIO2, GPIO17, and GPIO33 are preserved.
- TFT and touch share SPI with independent chip selects.
- BME280 I2C is independent from SPI and IR.
- GPIO4 and GPIO16 are output-capable on ESP32 WROOM.
- microSD remains unused.
