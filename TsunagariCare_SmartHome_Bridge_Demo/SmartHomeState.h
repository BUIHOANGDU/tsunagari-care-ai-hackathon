#ifndef SMART_HOME_STATE_H
#define SMART_HOME_STATE_H

#include <Arduino.h>
#include <math.h>

struct SmartHomeState
{
  bool livingLight = false;
  bool bedroomLight = false;

  bool acPower = false;
  int acSetTemperature = 26;

  float roomTemperature = NAN;
  float humidity = NAN;
  float pressure = NAN;

  bool bme280Available = false;

  bool wifiConnected = false;
  bool serverConnected = false;

  unsigned long lastCommandAt = 0;
};

#endif
