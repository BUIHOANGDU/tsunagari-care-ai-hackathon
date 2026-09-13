#ifndef SMART_HOME_DISPLAY_H
#define SMART_HOME_DISPLAY_H

#include <Arduino.h>
#include <Adafruit_GFX.h>
#include <Adafruit_ILI9341.h>
#include "SmartHomeState.h"

enum UiPage
{
  UI_HOME,
  UI_DEVICES,
  UI_SYSTEM
};

class SmartHomeDisplay
{
public:
  SmartHomeDisplay();

  void begin();
  void showBootStatus(const char *label, const char *status);
  void update(unsigned long now, const SmartHomeState &state);
  void setPage(UiPage page);
  UiPage page() const;

private:
  Adafruit_ILI9341 tft_;
  bool begun_;
  UiPage currentPage_;
  UiPage drawnPage_;
  unsigned long bootHoldUntil_;

  bool cacheValid_;
  bool lastLivingLight_;
  bool lastBedroomLight_;
  bool lastAcPower_;
  int lastAcSetTemperature_;
  int lastTemperatureTenth_;
  int lastHumidityWhole_;
  int lastPressureWhole_;
  bool lastBme280Available_;
  bool lastWifiConnected_;
  bool lastServerConnected_;
  unsigned long lastUptimeSeconds_;
  long lastRssi_;
  unsigned long lastCommandAgeSeconds_;

  void resetCache();
  void invalidateCache();

  void drawBootScreen();
  void drawStaticFrame();
  void drawHomeStatic();
  void drawDevicesStatic();
  void drawSystemStatic();
  void updateHome(unsigned long now, const SmartHomeState &state);
  void updateDevices(unsigned long now, const SmartHomeState &state);
  void updateSystem(unsigned long now, const SmartHomeState &state);

  void drawHeaderStatus(const SmartHomeState &state);
  void drawBottomNav(UiPage activePage);
  void drawDeviceCard(
      int16_t x,
      int16_t y,
      int16_t w,
      int16_t h,
      const char *label,
      bool active,
      bool acCard,
      int acSetTemperature);
  void drawEnvironmentBar(const SmartHomeState &state);
  void drawDevicesRows(const SmartHomeState &state);
  void drawSystemRows(unsigned long now, const SmartHomeState &state);

  void drawPageTitle(const char *title, const char *subtitle);
  void drawEnvironmentCell(int16_t x, int16_t w, const char *label, const char *value, uint8_t valueSize);
  void drawValueRow(int16_t y, const char *label, const char *value, uint16_t valueColor);
  void drawBulbIcon(int16_t cx, int16_t cy, bool active);
  void drawAcIcon(int16_t x, int16_t y, bool active);
  void drawStatusDot(int16_t x, int16_t y, uint16_t color);
  void drawNavItem(int16_t x, int16_t w, const char *label, bool active);
  void drawText(const char *text, int16_t x, int16_t y, uint8_t size, uint16_t color);
  void drawCenteredText(const char *text, int16_t x, int16_t y, int16_t w, uint8_t size, uint16_t color);

  int displayTemperatureTenth(const SmartHomeState &state) const;
  int displayHumidityWhole(const SmartHomeState &state) const;
  int displayPressureWhole(const SmartHomeState &state) const;
  const char *networkLabel(const SmartHomeState &state) const;
  uint16_t networkColor(const SmartHomeState &state) const;
  String temperatureText(int tenth) const;
  String humidityText(int humidityWhole) const;
  String pressureText(int pressureWhole) const;
  String uptimeText(unsigned long now) const;
  String commandAgeText(unsigned long now, unsigned long lastCommandAt) const;
};

#endif
