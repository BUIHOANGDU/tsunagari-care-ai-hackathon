#include "SmartHomeDisplay.h"

#include <SPI.h>
#include <WiFi.h>
#include <math.h>
#include <string.h>
#include "config.h"
#include "SmartHomeUiLayout.h"

#ifndef TFT_SCK_PIN
#define TFT_SCK_PIN 18
#endif

#ifndef TFT_MOSI_PIN
#define TFT_MOSI_PIN 23
#endif

#ifndef TFT_MISO_PIN
#define TFT_MISO_PIN 19
#endif

#ifndef TFT_CS_PIN
#define TFT_CS_PIN 5
#endif

#ifndef TFT_DC_PIN
#define TFT_DC_PIN 27
#endif

#ifndef TFT_RST_PIN
#define TFT_RST_PIN 14
#endif

namespace
{
const int SENSOR_UNAVAILABLE = -32768;

const uint16_t UI_BG = 0x0005;
const uint16_t UI_PANEL = 0x018C;
const uint16_t UI_CARD = 0x03D5;
const uint16_t UI_CARD_DARK = 0x020B;
const uint16_t UI_CARD_SOFT = 0x02B2;
const uint16_t UI_BORDER = 0x1A57;
const uint16_t UI_BORDER_ACTIVE = 0x07BF;
const uint16_t UI_TEXT_PRIMARY = 0xFFFF;
const uint16_t UI_TEXT_SECONDARY = 0xBDF7;
const uint16_t UI_ACCENT = 0x07FF;
const uint16_t UI_ACCENT_DARK = 0x03B6;
const uint16_t UI_SUCCESS = 0x07E0;
const uint16_t UI_ERROR = 0xF986;
const uint16_t UI_INACTIVE = 0x7BEF;
const uint16_t UI_WARNING = 0xFFE0;
const uint16_t UI_ROW_LINE = 0x126F;

uint16_t cardBorder(bool active)
{
  return active ? UI_BORDER_ACTIVE : UI_BORDER;
}
}

SmartHomeDisplay::SmartHomeDisplay()
    : tft_(TFT_CS_PIN, TFT_DC_PIN, TFT_RST_PIN),
      begun_(false),
      currentPage_(UI_HOME),
      drawnPage_(UI_HOME),
      bootHoldUntil_(0)
{
  resetCache();
}

void SmartHomeDisplay::begin()
{
  SPI.begin(TFT_SCK_PIN, TFT_MISO_PIN, TFT_MOSI_PIN, TFT_CS_PIN);
  tft_.begin();
  tft_.setRotation(1);
  begun_ = true;

  Serial.print("TFT: width=");
  Serial.print(tft_.width());
  Serial.print(" height=");
  Serial.println(tft_.height());
  if (tft_.width() != UI_SCREEN_W || tft_.height() != UI_SCREEN_H)
  {
    Serial.println("TFT: WARNING expected landscape 320x240");
  }

  drawBootScreen();
  bootHoldUntil_ = millis() + 1000UL;
}

void SmartHomeDisplay::showBootStatus(const char *label, const char *status)
{
  if (!begun_)
  {
    return;
  }

  int16_t y = 170;
  if (strcmp(label, "Wi-Fi") == 0)
  {
    y = 130;
  }
  else if (strcmp(label, "BME280") == 0)
  {
    y = 150;
  }

  tft_.fillRect(32, y - 2, 256, 14, UI_BG);
  drawText(label, 44, y, 1, UI_TEXT_SECONDARY);
  drawText(status, 178, y, 1, UI_TEXT_PRIMARY);
}

void SmartHomeDisplay::update(unsigned long now, const SmartHomeState &state)
{
  if (!begun_)
  {
    return;
  }

  if (bootHoldUntil_ != 0)
  {
    if (static_cast<long>(now - bootHoldUntil_) < 0)
    {
      return;
    }
    bootHoldUntil_ = 0;
  }

  if (drawnPage_ != currentPage_ || !cacheValid_)
  {
    drawStaticFrame();
    if (currentPage_ == UI_HOME)
    {
      drawHomeStatic();
    }
    else if (currentPage_ == UI_DEVICES)
    {
      drawDevicesStatic();
    }
    else
    {
      drawSystemStatic();
    }
    drawnPage_ = currentPage_;
    invalidateCache();
  }

  if (currentPage_ == UI_HOME)
  {
    updateHome(now, state);
  }
  else if (currentPage_ == UI_DEVICES)
  {
    updateDevices(now, state);
  }
  else
  {
    updateSystem(now, state);
  }

  cacheValid_ = true;
}

void SmartHomeDisplay::setPage(UiPage page)
{
  if (currentPage_ != page)
  {
    currentPage_ = page;
    invalidateCache();
  }
}

UiPage SmartHomeDisplay::page() const
{
  return currentPage_;
}

void SmartHomeDisplay::resetCache()
{
  cacheValid_ = false;
  lastLivingLight_ = false;
  lastBedroomLight_ = false;
  lastAcPower_ = false;
  lastAcSetTemperature_ = SENSOR_UNAVAILABLE;
  lastTemperatureTenth_ = SENSOR_UNAVAILABLE;
  lastHumidityWhole_ = SENSOR_UNAVAILABLE;
  lastPressureWhole_ = SENSOR_UNAVAILABLE;
  lastBme280Available_ = false;
  lastWifiConnected_ = false;
  lastServerConnected_ = false;
  lastUptimeSeconds_ = 0xFFFFFFFF;
  lastRssi_ = 9999;
  lastCommandAgeSeconds_ = 0xFFFFFFFF;
}

void SmartHomeDisplay::invalidateCache()
{
  resetCache();
}

void SmartHomeDisplay::drawBootScreen()
{
  tft_.fillScreen(UI_BG);
  tft_.drawRoundRect(10, 10, 300, 220, 10, UI_BORDER);
  drawCenteredText("TSUNAGARI CARE", 0, 54, UI_SCREEN_W, 2, UI_ACCENT);
  drawCenteredText("SMART HOME", 0, 78, UI_SCREEN_W, 2, UI_TEXT_PRIMARY);
  drawCenteredText("Initializing...", 0, 112, UI_SCREEN_W, 1, UI_TEXT_SECONDARY);
  drawText("Wi-Fi", 44, 130, 1, UI_TEXT_SECONDARY);
  drawText("...", 178, 130, 1, UI_TEXT_PRIMARY);
  drawText("BME280", 44, 150, 1, UI_TEXT_SECONDARY);
  drawText("...", 178, 150, 1, UI_TEXT_PRIMARY);
  drawText("System", 44, 170, 1, UI_TEXT_SECONDARY);
  drawText("...", 178, 170, 1, UI_TEXT_PRIMARY);
}

void SmartHomeDisplay::drawStaticFrame()
{
  tft_.fillScreen(UI_BG);
  tft_.fillRoundRect(4, 4, 312, 232, UI_PANEL_RADIUS, UI_PANEL);
  tft_.drawRoundRect(4, 4, 312, 232, UI_PANEL_RADIUS, UI_BORDER);
}

void SmartHomeDisplay::drawHomeStatic()
{
  drawPageTitle("TSUNAGARI CARE", "SMART HOME");
  drawBottomNav(UI_HOME);
}

void SmartHomeDisplay::drawDevicesStatic()
{
  drawPageTitle("DEVICES", "Device status");
  drawBottomNav(UI_DEVICES);
}

void SmartHomeDisplay::drawSystemStatic()
{
  drawPageTitle("SYSTEM", "Bridge health");
  drawBottomNav(UI_SYSTEM);
}

void SmartHomeDisplay::updateHome(unsigned long now, const SmartHomeState &state)
{
  if (!cacheValid_ ||
      lastWifiConnected_ != state.wifiConnected ||
      lastServerConnected_ != state.serverConnected)
  {
    drawHeaderStatus(state);
  }

  if (!cacheValid_ || lastLivingLight_ != state.livingLight)
  {
    drawDeviceCard(UI_LIVING_CARD.x, UI_LIVING_CARD.y, UI_LIVING_CARD.w, UI_LIVING_CARD.h, "LIVING", state.livingLight, false, state.acSetTemperature);
  }

  if (!cacheValid_ || lastBedroomLight_ != state.bedroomLight)
  {
    drawDeviceCard(UI_BEDROOM_CARD.x, UI_BEDROOM_CARD.y, UI_BEDROOM_CARD.w, UI_BEDROOM_CARD.h, "BEDROOM", state.bedroomLight, false, state.acSetTemperature);
  }

  if (!cacheValid_ ||
      lastAcPower_ != state.acPower ||
      lastAcSetTemperature_ != state.acSetTemperature)
  {
    drawDeviceCard(UI_AC_CARD.x, UI_AC_CARD.y, UI_AC_CARD.w, UI_AC_CARD.h, "AC", state.acPower, true, state.acSetTemperature);
  }

  int tempTenth = displayTemperatureTenth(state);
  int humidityWhole = displayHumidityWhole(state);
  int pressureWhole = displayPressureWhole(state);
  if (!cacheValid_ ||
      lastTemperatureTenth_ != tempTenth ||
      lastHumidityWhole_ != humidityWhole ||
      lastPressureWhole_ != pressureWhole ||
      lastBme280Available_ != state.bme280Available)
  {
    drawEnvironmentBar(state);
  }

  lastLivingLight_ = state.livingLight;
  lastBedroomLight_ = state.bedroomLight;
  lastAcPower_ = state.acPower;
  lastAcSetTemperature_ = state.acSetTemperature;
  lastTemperatureTenth_ = tempTenth;
  lastHumidityWhole_ = humidityWhole;
  lastPressureWhole_ = pressureWhole;
  lastBme280Available_ = state.bme280Available;
  lastWifiConnected_ = state.wifiConnected;
  lastServerConnected_ = state.serverConnected;
  (void)now;
}

void SmartHomeDisplay::updateDevices(unsigned long now, const SmartHomeState &state)
{
  bool changed = !cacheValid_ ||
                 lastLivingLight_ != state.livingLight ||
                 lastBedroomLight_ != state.bedroomLight ||
                 lastAcPower_ != state.acPower ||
                 lastAcSetTemperature_ != state.acSetTemperature ||
                 lastTemperatureTenth_ != displayTemperatureTenth(state) ||
                 lastHumidityWhole_ != displayHumidityWhole(state) ||
                 lastBme280Available_ != state.bme280Available ||
                 lastWifiConnected_ != state.wifiConnected ||
                 lastServerConnected_ != state.serverConnected;

  if (changed)
  {
    drawHeaderStatus(state);
    drawDevicesRows(state);
  }

  lastLivingLight_ = state.livingLight;
  lastBedroomLight_ = state.bedroomLight;
  lastAcPower_ = state.acPower;
  lastAcSetTemperature_ = state.acSetTemperature;
  lastTemperatureTenth_ = displayTemperatureTenth(state);
  lastHumidityWhole_ = displayHumidityWhole(state);
  lastBme280Available_ = state.bme280Available;
  lastWifiConnected_ = state.wifiConnected;
  lastServerConnected_ = state.serverConnected;
  (void)now;
}

void SmartHomeDisplay::updateSystem(unsigned long now, const SmartHomeState &state)
{
  unsigned long uptimeSeconds = now / 1000UL;
  long rssi = state.wifiConnected ? WiFi.RSSI() : 0;
  unsigned long commandAge = state.lastCommandAt == 0 ? 0xFFFFFFFF : (now - state.lastCommandAt) / 1000UL;

  bool changed = !cacheValid_ ||
                 lastWifiConnected_ != state.wifiConnected ||
                 lastServerConnected_ != state.serverConnected ||
                 lastBme280Available_ != state.bme280Available ||
                 lastUptimeSeconds_ != uptimeSeconds ||
                 lastRssi_ != rssi ||
                 lastCommandAgeSeconds_ != commandAge;

  if (changed)
  {
    drawHeaderStatus(state);
    drawSystemRows(now, state);
  }

  lastWifiConnected_ = state.wifiConnected;
  lastServerConnected_ = state.serverConnected;
  lastBme280Available_ = state.bme280Available;
  lastUptimeSeconds_ = uptimeSeconds;
  lastRssi_ = rssi;
  lastCommandAgeSeconds_ = commandAge;
}

void SmartHomeDisplay::drawHeaderStatus(const SmartHomeState &state)
{
  tft_.fillRoundRect(184, 8, 124, 24, 6, UI_CARD_DARK);
  tft_.drawRoundRect(184, 8, 124, 24, 6, UI_BORDER);
  drawText("Wi-Fi", 194, 16, 1, state.wifiConnected ? UI_TEXT_PRIMARY : UI_INACTIVE);
  drawStatusDot(238, 20, networkColor(state));
  drawText(networkLabel(state), 250, 16, 1, networkColor(state));
}

void SmartHomeDisplay::drawBottomNav(UiPage activePage)
{
  tft_.fillRoundRect(UI_NAV_HOME.x, UI_NAV_HOME.y, UI_NAV_HOME.w + UI_NAV_DEVICES.w + UI_NAV_SYSTEM.w, UI_NAV_HOME.h, 8, UI_CARD_DARK);
  tft_.drawRoundRect(UI_NAV_HOME.x, UI_NAV_HOME.y, UI_NAV_HOME.w + UI_NAV_DEVICES.w + UI_NAV_SYSTEM.w, UI_NAV_HOME.h, 8, UI_BORDER);
  tft_.drawFastVLine(UI_NAV_DEVICES.x, UI_NAV_HOME.y + 7, UI_NAV_HOME.h - 14, UI_BORDER);
  tft_.drawFastVLine(UI_NAV_SYSTEM.x, UI_NAV_HOME.y + 7, UI_NAV_HOME.h - 14, UI_BORDER);
  drawNavItem(UI_NAV_HOME.x, UI_NAV_HOME.w, "HOME", activePage == UI_HOME);
  drawNavItem(UI_NAV_DEVICES.x, UI_NAV_DEVICES.w, "DEVICES", activePage == UI_DEVICES);
  drawNavItem(UI_NAV_SYSTEM.x, UI_NAV_SYSTEM.w, "SYSTEM", activePage == UI_SYSTEM);
}

void SmartHomeDisplay::drawDeviceCard(
    int16_t x,
    int16_t y,
    int16_t w,
    int16_t h,
    const char *label,
    bool active,
    bool acCard,
    int acSetTemperature)
{
  uint16_t fill = active ? UI_CARD : UI_CARD_SOFT;
  uint16_t accent = active ? UI_ACCENT : UI_INACTIVE;
  uint16_t titleColor = active ? UI_TEXT_PRIMARY : UI_TEXT_SECONDARY;
  uint16_t stateColor = active ? UI_SUCCESS : UI_INACTIVE;

  tft_.fillRoundRect(x, y, w, h, UI_CARD_RADIUS, fill);
  tft_.drawRoundRect(x, y, w, h, UI_CARD_RADIUS, cardBorder(active));
  if (active)
  {
    tft_.drawFastHLine(x + 9, y + 22, w - 18, UI_ACCENT_DARK);
  }
  drawText(label, x + 8, y + 8, 1, titleColor);

  if (acCard)
  {
    drawAcIcon(x + 9, y + 29, active);
    drawText(active ? "ON" : "OFF", x + 58, y + 32, 2, stateColor);
    String tempText = String(acSetTemperature) + " C";
    drawText(tempText.c_str(), x + 58, y + 50, 1, active ? UI_TEXT_PRIMARY : UI_TEXT_SECONDARY);
    tft_.fillRoundRect(UI_AC_MINUS_BUTTON.x, UI_AC_MINUS_BUTTON.y, UI_AC_MINUS_BUTTON.w, UI_AC_MINUS_BUTTON.h, 6, active ? UI_ACCENT_DARK : UI_CARD_DARK);
    tft_.drawRoundRect(UI_AC_MINUS_BUTTON.x, UI_AC_MINUS_BUTTON.y, UI_AC_MINUS_BUTTON.w, UI_AC_MINUS_BUTTON.h, 6, UI_BORDER);
    tft_.fillRoundRect(UI_AC_PLUS_BUTTON.x, UI_AC_PLUS_BUTTON.y, UI_AC_PLUS_BUTTON.w, UI_AC_PLUS_BUTTON.h, 6, active ? UI_ACCENT_DARK : UI_CARD_DARK);
    tft_.drawRoundRect(UI_AC_PLUS_BUTTON.x, UI_AC_PLUS_BUTTON.y, UI_AC_PLUS_BUTTON.w, UI_AC_PLUS_BUTTON.h, 6, UI_BORDER);
    drawCenteredText("-", UI_AC_MINUS_BUTTON.x, UI_AC_MINUS_BUTTON.y + 4, UI_AC_MINUS_BUTTON.w, 2, UI_TEXT_PRIMARY);
    drawCenteredText("+", UI_AC_PLUS_BUTTON.x, UI_AC_PLUS_BUTTON.y + 4, UI_AC_PLUS_BUTTON.w, 2, UI_TEXT_PRIMARY);
  }
  else
  {
    drawBulbIcon(x + w / 2, y + 39, active);
    drawCenteredText(active ? "ON" : "OFF", x, y + 66, w, 2, stateColor);
  }
}

void SmartHomeDisplay::drawEnvironmentBar(const SmartHomeState &state)
{
  int tempTenth = displayTemperatureTenth(state);
  int humidityWhole = displayHumidityWhole(state);
  int pressureWhole = displayPressureWhole(state);

  tft_.fillRoundRect(UI_ENV_BAR.x, UI_ENV_BAR.y, UI_ENV_BAR.w, UI_ENV_BAR.h, UI_CARD_RADIUS, UI_CARD_DARK);
  tft_.drawRoundRect(UI_ENV_BAR.x, UI_ENV_BAR.y, UI_ENV_BAR.w, UI_ENV_BAR.h, UI_CARD_RADIUS, UI_BORDER);
  tft_.drawFastVLine(109, UI_ENV_BAR.y + 8, UI_ENV_BAR.h - 16, UI_ROW_LINE);
  tft_.drawFastVLine(210, UI_ENV_BAR.y + 8, UI_ENV_BAR.h - 16, UI_ROW_LINE);

  String tempText = temperatureText(tempTenth);
  String humText = humidityText(humidityWhole);
  String pressText = pressureText(pressureWhole);
  drawEnvironmentCell(14, 88, "Room Temp", tempText.c_str(), 2);
  drawEnvironmentCell(118, 78, "Humidity", humText.c_str(), 2);
  drawEnvironmentCell(219, 84, "Pressure", pressText.c_str(), 1);

  if (!state.bme280Available)
  {
    drawStatusDot(297, 146, UI_ERROR);
  }
}

void SmartHomeDisplay::drawDevicesRows(const SmartHomeState &state)
{
  tft_.fillRoundRect(UI_ROW_PANEL.x, UI_ROW_PANEL.y, UI_ROW_PANEL.w, UI_ROW_PANEL.h, UI_CARD_RADIUS, UI_CARD_DARK);
  tft_.drawRoundRect(UI_ROW_PANEL.x, UI_ROW_PANEL.y, UI_ROW_PANEL.w, UI_ROW_PANEL.h, UI_CARD_RADIUS, UI_BORDER);

  int16_t y = UI_DEVICES_ROW_Y;
  drawValueRow(y, "Living Light", state.livingLight ? "ON" : "OFF", state.livingLight ? UI_SUCCESS : UI_INACTIVE);
  y += UI_ROW_H + UI_ROW_GAP;
  drawValueRow(y, "Bedroom Light", state.bedroomLight ? "ON" : "OFF", state.bedroomLight ? UI_SUCCESS : UI_INACTIVE);
  y += UI_ROW_H + UI_ROW_GAP;
  drawValueRow(y, "Air Conditioner", state.acPower ? "ON" : "OFF", state.acPower ? UI_SUCCESS : UI_INACTIVE);
  y += UI_ROW_H + UI_ROW_GAP;
  String acText = String(state.acSetTemperature) + " C";
  drawValueRow(y, "AC Set", acText.c_str(), UI_TEXT_PRIMARY);
  y += UI_ROW_H + UI_ROW_GAP;
  String tempText = temperatureText(displayTemperatureTenth(state));
  drawValueRow(y, "Room Temp", tempText.c_str(), UI_TEXT_PRIMARY);
  y += UI_ROW_H + UI_ROW_GAP;
  String humText = humidityText(displayHumidityWhole(state));
  drawValueRow(y, "Humidity", humText.c_str(), UI_TEXT_PRIMARY);
}

void SmartHomeDisplay::drawSystemRows(unsigned long now, const SmartHomeState &state)
{
  tft_.fillRoundRect(UI_ROW_PANEL.x, UI_ROW_PANEL.y, UI_ROW_PANEL.w, UI_ROW_PANEL.h, UI_CARD_RADIUS, UI_CARD_DARK);
  tft_.drawRoundRect(UI_ROW_PANEL.x, UI_ROW_PANEL.y, UI_ROW_PANEL.w, UI_ROW_PANEL.h, UI_CARD_RADIUS, UI_BORDER);

  int16_t y = UI_SYSTEM_ROW_Y;
  drawValueRow(y, "Wi-Fi", state.wifiConnected ? "Connected" : "Offline", state.wifiConnected ? UI_SUCCESS : UI_ERROR);
  y += UI_ROW_H;
  drawValueRow(y, "Server", state.serverConnected ? "Online" : "Offline", state.serverConnected ? UI_SUCCESS : UI_ERROR);
  y += UI_ROW_H;
  drawValueRow(y, "BME280", state.bme280Available ? "OK" : "Error", state.bme280Available ? UI_SUCCESS : UI_ERROR);
  y += UI_ROW_H;
  drawValueRow(y, "ESP32", "OK", UI_SUCCESS);
  y += UI_ROW_H;
  String uptime = uptimeText(now);
  drawValueRow(y, "Uptime", uptime.c_str(), UI_TEXT_PRIMARY);
  y += UI_ROW_H;
  if (state.wifiConnected)
  {
    String rssiText = String(WiFi.RSSI()) + " dBm";
    drawValueRow(y, "RSSI", rssiText.c_str(), UI_TEXT_PRIMARY);
  }
  else
  {
    drawValueRow(y, "RSSI", "--", UI_INACTIVE);
  }
  y += UI_ROW_H;
  String commandAge = commandAgeText(now, state.lastCommandAt);
  drawValueRow(y, "Last cmd", commandAge.c_str(), UI_TEXT_PRIMARY);
}

void SmartHomeDisplay::drawPageTitle(const char *title, const char *subtitle)
{
  drawText(title, 16, 10, 1, UI_ACCENT);
  drawText(subtitle, 16, 24, 1, UI_TEXT_SECONDARY);
}

void SmartHomeDisplay::drawEnvironmentCell(int16_t x, int16_t w, const char *label, const char *value, uint8_t valueSize)
{
  drawText(label, x, UI_ENV_BAR.y + 8, 1, UI_TEXT_SECONDARY);
  if (valueSize > 1)
  {
    drawCenteredText(value, x - 4, UI_ENV_BAR.y + 24, w, valueSize, UI_TEXT_PRIMARY);
  }
  else
  {
    drawText(value, x, UI_ENV_BAR.y + 27, valueSize, UI_TEXT_PRIMARY);
  }
}

void SmartHomeDisplay::drawValueRow(int16_t y, const char *label, const char *value, uint16_t valueColor)
{
  tft_.drawFastHLine(UI_ROW_PANEL.x + 10, y + UI_ROW_H - 1, UI_ROW_PANEL.w - 20, UI_ROW_LINE);
  drawText(label, UI_ROW_LABEL_X, y + 4, 1, UI_TEXT_SECONDARY);
  drawText(value, UI_ROW_VALUE_X, y + 4, 1, valueColor);
}

void SmartHomeDisplay::drawBulbIcon(int16_t cx, int16_t cy, bool active)
{
  uint16_t glow = active ? UI_WARNING : UI_INACTIVE;
  uint16_t cap = active ? UI_ACCENT : UI_BORDER;
  tft_.fillCircle(cx, cy + 3, 9, glow);
  tft_.fillRoundRect(cx - 11, cy - 13, 22, 14, 4, cap);
  tft_.fillRect(cx - 4, cy - 18, 8, 6, cap);
  tft_.drawFastHLine(cx - 7, cy + 15, 14, cap);
  if (active)
  {
    tft_.drawLine(cx - 17, cy + 10, cx - 24, cy + 14, glow);
    tft_.drawLine(cx, cy + 17, cx, cy + 24, glow);
    tft_.drawLine(cx + 17, cy + 10, cx + 24, cy + 14, glow);
  }
}

void SmartHomeDisplay::drawAcIcon(int16_t x, int16_t y, bool active)
{
  uint16_t color = active ? 0xCFFF : UI_INACTIVE;
  uint16_t accent = active ? UI_ACCENT : UI_BORDER;
  tft_.fillRoundRect(x, y, 40, 15, 4, color);
  tft_.drawRoundRect(x, y, 40, 15, 4, accent);
  tft_.drawFastHLine(x + 5, y + 11, 30, UI_BORDER);
  tft_.drawFastHLine(x + 8, y + 19, 24, accent);
  tft_.drawLine(x + 9, y + 22, x + 5, y + 27, accent);
  tft_.drawLine(x + 20, y + 22, x + 20, y + 28, accent);
  tft_.drawLine(x + 31, y + 22, x + 35, y + 27, accent);
}

void SmartHomeDisplay::drawStatusDot(int16_t x, int16_t y, uint16_t color)
{
  tft_.fillCircle(x, y, 5, color);
}

void SmartHomeDisplay::drawNavItem(int16_t x, int16_t w, const char *label, bool active)
{
  uint16_t fill = active ? UI_ACCENT_DARK : UI_CARD_DARK;
  uint16_t color = active ? UI_TEXT_PRIMARY : UI_TEXT_SECONDARY;
  if (active)
  {
    tft_.fillRoundRect(x + 3, UI_NAV_HOME.y + 4, w - 6, UI_NAV_HOME.h - 8, 7, fill);
    tft_.drawRoundRect(x + 3, UI_NAV_HOME.y + 4, w - 6, UI_NAV_HOME.h - 8, 7, UI_ACCENT);
  }
  drawCenteredText(label, x, UI_NAV_HOME.y + 16, w, 1, color);
}

void SmartHomeDisplay::drawText(const char *text, int16_t x, int16_t y, uint8_t size, uint16_t color)
{
  tft_.setTextWrap(false);
  tft_.setTextSize(size);
  tft_.setTextColor(color);
  tft_.setCursor(x, y);
  tft_.print(text);
}

void SmartHomeDisplay::drawCenteredText(const char *text, int16_t x, int16_t y, int16_t w, uint8_t size, uint16_t color)
{
  int16_t x1;
  int16_t y1;
  uint16_t textW;
  uint16_t textH;
  tft_.setTextSize(size);
  tft_.getTextBounds(text, 0, y, &x1, &y1, &textW, &textH);
  int16_t textX = x + (w - textW) / 2;
  drawText(text, textX, y, size, color);
}

int SmartHomeDisplay::displayTemperatureTenth(const SmartHomeState &state) const
{
  if (!state.bme280Available || isnan(state.roomTemperature))
  {
    return SENSOR_UNAVAILABLE;
  }
  return static_cast<int>(roundf(state.roomTemperature * 10.0F));
}

int SmartHomeDisplay::displayHumidityWhole(const SmartHomeState &state) const
{
  if (!state.bme280Available || isnan(state.humidity))
  {
    return SENSOR_UNAVAILABLE;
  }
  return static_cast<int>(roundf(state.humidity));
}

int SmartHomeDisplay::displayPressureWhole(const SmartHomeState &state) const
{
  if (!state.bme280Available || isnan(state.pressure))
  {
    return SENSOR_UNAVAILABLE;
  }
  return static_cast<int>(roundf(state.pressure));
}

const char *SmartHomeDisplay::networkLabel(const SmartHomeState &state) const
{
  if (!state.wifiConnected)
  {
    return "OFFLINE";
  }

  if (!state.serverConnected)
  {
    return "CLOUD OFF";
  }

  return "ONLINE";
}

uint16_t SmartHomeDisplay::networkColor(const SmartHomeState &state) const
{
  if (!state.wifiConnected)
  {
    return UI_ERROR;
  }

  if (!state.serverConnected)
  {
    return UI_WARNING;
  }

  return UI_SUCCESS;
}

String SmartHomeDisplay::temperatureText(int tenth) const
{
  if (tenth == SENSOR_UNAVAILABLE)
  {
    return "--.- C";
  }

  int whole = tenth / 10;
  int decimal = abs(tenth % 10);
  return String(whole) + "." + String(decimal) + " C";
}

String SmartHomeDisplay::humidityText(int humidityWhole) const
{
  if (humidityWhole == SENSOR_UNAVAILABLE)
  {
    return "--%";
  }

  return String(humidityWhole) + "%";
}

String SmartHomeDisplay::pressureText(int pressureWhole) const
{
  if (pressureWhole == SENSOR_UNAVAILABLE)
  {
    return "--- hPa";
  }

  return String(pressureWhole) + " hPa";
}

String SmartHomeDisplay::uptimeText(unsigned long now) const
{
  unsigned long seconds = now / 1000UL;
  unsigned long minutes = seconds / 60UL;
  unsigned long hours = minutes / 60UL;
  if (hours > 0)
  {
    return String(hours) + "h " + String(minutes % 60UL) + "m";
  }
  return String(minutes) + "m " + String(seconds % 60UL) + "s";
}

String SmartHomeDisplay::commandAgeText(unsigned long now, unsigned long lastCommandAt) const
{
  if (lastCommandAt == 0)
  {
    return "--";
  }

  unsigned long ageSeconds = (now - lastCommandAt) / 1000UL;
  return String(ageSeconds) + "s ago";
}
