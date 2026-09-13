#include "SmartHomeFeedback.h"

#include "config.h"

#ifndef SYSTEM_WS2812_PIN
#define SYSTEM_WS2812_PIN 4
#endif

#ifndef BUZZER_PIN
#define BUZZER_PIN 16
#endif

#ifndef SYSTEM_LED_BRIGHTNESS
#define SYSTEM_LED_BRIGHTNESS 48
#endif

#ifndef SYSTEM_ACTIVITY_MS
#define SYSTEM_ACTIVITY_MS 180
#endif

#ifndef BUZZER_CONFIRM_MS
#define BUZZER_CONFIRM_MS 60
#endif

#ifndef BUZZER_NAV_MS
#define BUZZER_NAV_MS 30
#endif

#ifndef BUZZER_ACTIVE_TYPE
#define BUZZER_ACTIVE_TYPE 1
#endif

#ifndef BUZZER_PASSIVE_FREQUENCY
#define BUZZER_PASSIVE_FREQUENCY 2400
#endif

namespace
{
const uint16_t SYSTEM_PIXEL_COUNT = 1;
}

SmartHomeFeedback::SmartHomeFeedback()
    : pixel_(SYSTEM_PIXEL_COUNT, SYSTEM_WS2812_PIN, NEO_GRB + NEO_KHZ800),
      begun_(false),
      activityUntil_(0),
      buzzerUntil_(0),
      lastPixelColor_(0xFFFFFFFF),
      buzzerRunning_(false)
{
}

void SmartHomeFeedback::begin()
{
  pixel_.begin();
  pixel_.setBrightness(SYSTEM_LED_BRIGHTNESS);
  pixel_.clear();
  pixel_.show();

  pinMode(BUZZER_PIN, OUTPUT);
  digitalWrite(BUZZER_PIN, LOW);

  begun_ = true;
  writePixel(pixel_.Color(0, 24, 48));

  Serial.print("Feedback: WS2812 pin=");
  Serial.print(SYSTEM_WS2812_PIN);
  Serial.print(" brightness=");
  Serial.println(SYSTEM_LED_BRIGHTNESS);
  Serial.print("Feedback: buzzer pin=");
  Serial.print(BUZZER_PIN);
  Serial.print(" activeType=");
  Serial.println(BUZZER_ACTIVE_TYPE);
}

void SmartHomeFeedback::update(unsigned long now, const SmartHomeState &state)
{
  if (!begun_)
  {
    return;
  }

  updateBuzzer(now);
  updatePixel(now, state);
}

void SmartHomeFeedback::notifyCommandSuccess(bool fromTouch)
{
  if (!begun_)
  {
    return;
  }

  unsigned long now = millis();
  startActivity(now);
  startBeep(now, BUZZER_CONFIRM_MS);

  Serial.print("Feedback: command success");
  Serial.println(fromTouch ? " touch" : " remote");
}

void SmartHomeFeedback::notifyNavigation()
{
  if (!begun_)
  {
    return;
  }

  startBeep(millis(), BUZZER_NAV_MS);
}

void SmartHomeFeedback::startActivity(unsigned long now)
{
  activityUntil_ = now + SYSTEM_ACTIVITY_MS;
  writePixel(pixel_.Color(0, 0, 80));
}

void SmartHomeFeedback::startBeep(unsigned long now, unsigned long durationMs)
{
  if (durationMs == 0)
  {
    return;
  }

  buzzerUntil_ = now + durationMs;
  buzzerRunning_ = true;

#if BUZZER_ACTIVE_TYPE
  digitalWrite(BUZZER_PIN, HIGH);
#else
  tone(BUZZER_PIN, BUZZER_PASSIVE_FREQUENCY);
#endif
}

void SmartHomeFeedback::updatePixel(unsigned long now, const SmartHomeState &state)
{
  if (activityUntil_ != 0)
  {
    if (static_cast<long>(now - activityUntil_) < 0)
    {
      writePixel(pixel_.Color(0, 0, 80));
      return;
    }

    activityUntil_ = 0;
  }

  writePixel(systemStatusColor(state));
}

void SmartHomeFeedback::updateBuzzer(unsigned long now)
{
  if (!buzzerRunning_)
  {
    return;
  }

  if (static_cast<long>(now - buzzerUntil_) < 0)
  {
    return;
  }

  stopBuzzer();
}

void SmartHomeFeedback::writePixel(uint32_t color)
{
  if (lastPixelColor_ == color)
  {
    return;
  }

  pixel_.setPixelColor(0, color);
  pixel_.show();
  lastPixelColor_ = color;
}

void SmartHomeFeedback::stopBuzzer()
{
#if BUZZER_ACTIVE_TYPE
  digitalWrite(BUZZER_PIN, LOW);
#else
  noTone(BUZZER_PIN);
#endif

  buzzerRunning_ = false;
}

uint32_t SmartHomeFeedback::systemStatusColor(const SmartHomeState &state)
{
  if (!state.wifiConnected)
  {
    return pixel_.Color(80, 0, 0);
  }

  if (!state.serverConnected)
  {
    return pixel_.Color(80, 55, 0);
  }

  return pixel_.Color(0, 80, 0);
}
