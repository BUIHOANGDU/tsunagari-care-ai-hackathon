#include "SmartHomeTouch.h"

#include <SPI.h>
#include "config.h"
#include "SmartHomeUiLayout.h"

#ifndef TOUCH_CS_PIN
#define TOUCH_CS_PIN 32
#endif

#ifndef TOUCH_IRQ_PIN
#define TOUCH_IRQ_PIN 35
#endif

#ifndef TFT_CS_PIN
#define TFT_CS_PIN 5
#endif

#ifndef TOUCH_MIN_X
#define TOUCH_MIN_X 200
#endif

#ifndef TOUCH_MAX_X
#define TOUCH_MAX_X 3900
#endif

#ifndef TOUCH_MIN_Y
#define TOUCH_MIN_Y 200
#endif

#ifndef TOUCH_MAX_Y
#define TOUCH_MAX_Y 3900
#endif

#ifndef TOUCH_SWAP_XY
#define TOUCH_SWAP_XY 0
#endif

#ifndef TOUCH_INVERT_X
#define TOUCH_INVERT_X 0
#endif

#ifndef TOUCH_INVERT_Y
#define TOUCH_INVERT_Y 0
#endif

#ifndef TOUCH_MIN_PRESSURE
#define TOUCH_MIN_PRESSURE 200
#endif

#ifndef TOUCH_DEBOUNCE_MS
#define TOUCH_DEBOUNCE_MS 180
#endif

#ifndef SMART_HOME_TOUCH_DEBUG
#define SMART_HOME_TOUCH_DEBUG 0
#endif

SmartHomeTouch::SmartHomeTouch()
    : touch_(TOUCH_CS_PIN, TOUCH_IRQ_PIN),
      begun_(false),
      wasPressed_(false),
      lastTapAt_(0)
{
}

void SmartHomeTouch::begin()
{
  pinMode(TFT_CS_PIN, OUTPUT);
  digitalWrite(TFT_CS_PIN, HIGH);
  pinMode(TOUCH_CS_PIN, OUTPUT);
  digitalWrite(TOUCH_CS_PIN, HIGH);
  touch_.begin();
  begun_ = true;

  Serial.print("Touch: XPT2046-compatible CS=");
  Serial.print(TOUCH_CS_PIN);
  Serial.print(" IRQ=");
  Serial.println(TOUCH_IRQ_PIN);
  Serial.println("Touch: calibration defaults active; enable SMART_HOME_TOUCH_DEBUG to calibrate");
}

bool SmartHomeTouch::update(unsigned long now, UiPage currentPage, SmartHomeTouchEvent *event)
{
  if (event == nullptr)
  {
    return false;
  }
  event->type = TOUCH_EVENT_NONE;

  if (!begun_)
  {
    return false;
  }

  int16_t x = 0;
  int16_t y = 0;
  int16_t pressure = 0;
  bool pressed = readPoint(&x, &y, &pressure);

  if (!pressed)
  {
    wasPressed_ = false;
    return false;
  }

  if (wasPressed_)
  {
    return false;
  }

  if (lastTapAt_ != 0 && now - lastTapAt_ < TOUCH_DEBOUNCE_MS)
  {
    wasPressed_ = true;
    return false;
  }

  wasPressed_ = true;
  lastTapAt_ = now;

  if (hitTest(x, y, currentPage, event))
  {
    event->x = x;
    event->y = y;
    return true;
  }

  return false;
}

bool SmartHomeTouch::readPoint(int16_t *x, int16_t *y, int16_t *pressure)
{
  digitalWrite(TFT_CS_PIN, HIGH);

  if (!touch_.touched())
  {
    return false;
  }

  TS_Point raw = touch_.getPoint();
  if (raw.z < TOUCH_MIN_PRESSURE)
  {
    return false;
  }

  mapRawPoint(raw, x, y);
  if (pressure != nullptr)
  {
    *pressure = raw.z;
  }
  logPoint(raw, *x, *y);
  return true;
}

bool SmartHomeTouch::hitTest(int16_t x, int16_t y, UiPage currentPage, SmartHomeTouchEvent *event)
{
  if (uiRectContains(UI_NAV_HOME, x, y))
  {
    event->type = TOUCH_EVENT_NAVIGATION;
    event->page = UI_HOME;
    return true;
  }

  if (uiRectContains(UI_NAV_DEVICES, x, y))
  {
    event->type = TOUCH_EVENT_NAVIGATION;
    event->page = UI_DEVICES;
    return true;
  }

  if (uiRectContains(UI_NAV_SYSTEM, x, y))
  {
    event->type = TOUCH_EVENT_NAVIGATION;
    event->page = UI_SYSTEM;
    return true;
  }

  if (currentPage != UI_HOME)
  {
    return false;
  }

  event->type = TOUCH_EVENT_COMMAND;
  event->page = currentPage;

  if (uiRectContains(UI_LIVING_CARD, x, y))
  {
    event->device = "living_light";
    event->action = "toggle";
    return true;
  }

  if (uiRectContains(UI_BEDROOM_CARD, x, y))
  {
    event->device = "bedroom_light";
    event->action = "toggle";
    return true;
  }

  if (uiRectContains(UI_AC_MINUS_BUTTON, x, y))
  {
    event->device = "air_conditioner";
    event->action = "temperature_down";
    return true;
  }

  if (uiRectContains(UI_AC_PLUS_BUTTON, x, y))
  {
    event->device = "air_conditioner";
    event->action = "temperature_up";
    return true;
  }

  if (uiRectContains(UI_AC_POWER_AREA, x, y))
  {
    event->device = "air_conditioner";
    event->action = "toggle";
    return true;
  }

  event->type = TOUCH_EVENT_NONE;
  return false;
}

void SmartHomeTouch::mapRawPoint(const TS_Point &raw, int16_t *x, int16_t *y)
{
  int32_t rawX = raw.x;
  int32_t rawY = raw.y;

  if (TOUCH_SWAP_XY)
  {
    int32_t temp = rawX;
    rawX = rawY;
    rawY = temp;
  }

  int32_t mappedX = map(rawX, TOUCH_MIN_X, TOUCH_MAX_X, 0, UI_SCREEN_W - 1);
  int32_t mappedY = map(rawY, TOUCH_MIN_Y, TOUCH_MAX_Y, 0, UI_SCREEN_H - 1);

  if (TOUCH_INVERT_X)
  {
    mappedX = UI_SCREEN_W - 1 - mappedX;
  }

  if (TOUCH_INVERT_Y)
  {
    mappedY = UI_SCREEN_H - 1 - mappedY;
  }

  mappedX = constrain(mappedX, 0, UI_SCREEN_W - 1);
  mappedY = constrain(mappedY, 0, UI_SCREEN_H - 1);

  *x = static_cast<int16_t>(mappedX);
  *y = static_cast<int16_t>(mappedY);
}

void SmartHomeTouch::logPoint(const TS_Point &raw, int16_t x, int16_t y)
{
  if (!SMART_HOME_TOUCH_DEBUG)
  {
    return;
  }

  Serial.print("Touch rawX=");
  Serial.print(raw.x);
  Serial.print(" rawY=");
  Serial.print(raw.y);
  Serial.print(" mappedX=");
  Serial.print(x);
  Serial.print(" mappedY=");
  Serial.print(y);
  Serial.print(" z=");
  Serial.println(raw.z);
}
