#ifndef SMART_HOME_FEEDBACK_H
#define SMART_HOME_FEEDBACK_H

#include <Arduino.h>
#include <Adafruit_NeoPixel.h>
#include "SmartHomeState.h"

enum SmartHomeFeedbackEvent
{
  FEEDBACK_CONFIRM,
  FEEDBACK_NAVIGATION,
  FEEDBACK_WARNING,
  FEEDBACK_EMERGENCY
};

class SmartHomeFeedback
{
public:
  SmartHomeFeedback();

  void begin();
  void update(unsigned long now, const SmartHomeState &state);
  void notifyCommandSuccess(bool fromTouch);
  void notifyNavigation();

private:
  Adafruit_NeoPixel pixel_;
  bool begun_;
  unsigned long activityUntil_;
  unsigned long buzzerUntil_;
  uint32_t lastPixelColor_;
  bool buzzerRunning_;

  void startActivity(unsigned long now);
  void startBeep(unsigned long now, unsigned long durationMs);
  void updatePixel(unsigned long now, const SmartHomeState &state);
  void updateBuzzer(unsigned long now);
  void writePixel(uint32_t color);
  void stopBuzzer();
  uint32_t systemStatusColor(const SmartHomeState &state);
};

#endif
