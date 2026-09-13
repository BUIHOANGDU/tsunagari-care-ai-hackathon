#ifndef SMART_HOME_TOUCH_H
#define SMART_HOME_TOUCH_H

#include <Arduino.h>
#include <XPT2046_Touchscreen.h>
#include "SmartHomeDisplay.h"

enum TouchEventType
{
  TOUCH_EVENT_NONE,
  TOUCH_EVENT_COMMAND,
  TOUCH_EVENT_NAVIGATION
};

struct SmartHomeTouchEvent
{
  TouchEventType type = TOUCH_EVENT_NONE;
  String device;
  String action;
  UiPage page = UI_HOME;
  int16_t x = 0;
  int16_t y = 0;
};

class SmartHomeTouch
{
public:
  SmartHomeTouch();

  void begin();
  bool update(unsigned long now, UiPage currentPage, SmartHomeTouchEvent *event);

private:
  XPT2046_Touchscreen touch_;
  bool begun_;
  bool wasPressed_;
  unsigned long lastTapAt_;

  bool readPoint(int16_t *x, int16_t *y, int16_t *pressure);
  bool hitTest(int16_t x, int16_t y, UiPage currentPage, SmartHomeTouchEvent *event);
  void mapRawPoint(const TS_Point &raw, int16_t *x, int16_t *y);
  void logPoint(const TS_Point &raw, int16_t x, int16_t y);
};

#endif
