#ifndef SMART_HOME_UI_LAYOUT_H
#define SMART_HOME_UI_LAYOUT_H

#include <Arduino.h>

struct UiRect
{
  int16_t x;
  int16_t y;
  int16_t w;
  int16_t h;
};

inline bool uiRectContains(const UiRect &rect, int16_t x, int16_t y)
{
  return x >= rect.x &&
         x < rect.x + rect.w &&
         y >= rect.y &&
         y < rect.y + rect.h;
}

const int16_t UI_SCREEN_W = 320;
const int16_t UI_SCREEN_H = 240;

const int16_t UI_MARGIN = 8;
const int16_t UI_PANEL_RADIUS = 7;
const int16_t UI_CARD_RADIUS = 7;
const int16_t UI_HEADER_Y = 8;
const int16_t UI_HEADER_H = 26;
const int16_t UI_CARD_Y = 42;
const int16_t UI_CARD_H = 88;
const int16_t UI_GAP = 5;

const UiRect UI_LIVING_CARD = {8, 42, 98, 88};
const UiRect UI_BEDROOM_CARD = {111, 42, 98, 88};
const UiRect UI_AC_CARD = {214, 42, 98, 88};
const UiRect UI_AC_POWER_AREA = {214, 42, 98, 58};
const UiRect UI_AC_MINUS_BUTTON = {222, 103, 30, 22};
const UiRect UI_AC_PLUS_BUTTON = {274, 103, 30, 22};

const UiRect UI_ENV_BAR = {8, 136, 304, 45};
const UiRect UI_NAV_HOME = {8, 190, 101, 42};
const UiRect UI_NAV_DEVICES = {109, 190, 101, 42};
const UiRect UI_NAV_SYSTEM = {210, 190, 102, 42};

const UiRect UI_ROW_PANEL = {12, 44, 296, 136};
const int16_t UI_ROW_LABEL_X = 24;
const int16_t UI_ROW_VALUE_X = 196;
const int16_t UI_ROW_H = 18;
const int16_t UI_ROW_GAP = 3;
const int16_t UI_DEVICES_ROW_Y = 54;
const int16_t UI_SYSTEM_ROW_Y = 51;

#endif
