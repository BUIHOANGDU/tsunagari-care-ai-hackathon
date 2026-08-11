#ifndef CONFIG_H
#define CONFIG_H

#define WIFI_SSID "YOUR_WIFI_SSID"
#define WIFI_PASSWORD "YOUR_WIFI_PASSWORD"

#define BRIDGE_API_URL "https://pt-tsunagari-care.onrender.com"

#define DEVICE_TOKEN "YOUR_DEVICE_TOKEN"
#define SMART_HOME_DEVICE_ID "smart_home_001"
#define LIGHT_DEVICE_ID "light_001"
#define IR_HUB_DEVICE_ID "ir_hub_001"
#define IR_RECEIVE_PIN 33
#define IR_SEND_PIN 17
#define LED_PIN 2

// Smart Home V2 hardware master pin map for Freenove ESP32 WROOM.
// Demo outputs stay disabled by default; set to 1 in local config.h after
// wiring has been verified.
#define SMART_HOME_DEMO_MODE 0

// Shared SPI bus for ILI9341 TFT and resistive touch controller.
#define TFT_SCK_PIN 18
#define TFT_MOSI_PIN 23
#define TFT_MISO_PIN 19

// ILI9341 TFT control pins.
#define TFT_CS_PIN 5
#define TFT_DC_PIN 27
#define TFT_RST_PIN 14

// Resistive touch control pins. TOUCH_IRQ_PIN is input-only.
#define TOUCH_CS_PIN 32
#define TOUCH_IRQ_PIN 35

// XPT2046-compatible resistive touch calibration examples for landscape UI.
// Measure your panel and adjust these in local config.h.
#define TOUCH_MIN_X 200
#define TOUCH_MAX_X 3900
#define TOUCH_MIN_Y 200
#define TOUCH_MAX_Y 3900
#define TOUCH_SWAP_XY 0
#define TOUCH_INVERT_X 1
#define TOUCH_INVERT_Y 1
#define TOUCH_MIN_PRESSURE 200
#define TOUCH_DEBOUNCE_MS 180
#define SMART_HOME_TOUCH_DEBUG 1

// BME280 uses I2C only.
#define BME280_SDA_PIN 21
#define BME280_SCL_PIN 22

// Physical demo LEDs.
#define DEMO_LIVING_LED_PIN 25
#define DEMO_BEDROOM_LED_PIN 26
#define DEMO_AC_LED_PIN 13

// Optional Phase 4+ peripherals.
#define SYSTEM_WS2812_PIN 4
#define BUZZER_PIN 16
#define SYSTEM_LED_BRIGHTNESS 48
#define SYSTEM_ACTIVITY_MS 180
#define BUZZER_CONFIRM_MS 60
#define BUZZER_NAV_MS 30
#define BUZZER_ACTIVE_TYPE 1
#define BUZZER_PASSIVE_FREQUENCY 2400

#endif
