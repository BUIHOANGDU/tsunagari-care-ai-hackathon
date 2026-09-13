#ifndef SMART_HOME_COMMAND_H
#define SMART_HOME_COMMAND_H

#include <Arduino.h>

struct SmartHomeCommand
{
  String commandId;
  String source;
  String type;
  String device;
  String action;
  String irCommandId;
  String key;
  String name;
  String category;
  String description;
  bool hasValue = false;
  int value = 0;
  bool requiresRemoteAck = true;
};

#endif
