#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <Wire.h>
#include <ArduinoJson.h>
#include <Adafruit_Sensor.h>
#include <Adafruit_BME280.h>
#include <IRremoteESP8266.h>
#include <IRrecv.h>
#include <IRsend.h>
#include <IRutils.h>
#include "config.h"
#include "SmartHomeState.h"
#include "SmartHomeCommand.h"
#include "SmartHomeDisplay.h"
#include "SmartHomeTouch.h"
#include "SmartHomeFeedback.h"

#ifndef SMART_HOME_DEMO_MODE
#define SMART_HOME_DEMO_MODE 0
#endif

#ifndef DEMO_LIVING_LED_PIN
#define DEMO_LIVING_LED_PIN -1
#endif

#ifndef DEMO_BEDROOM_LED_PIN
#define DEMO_BEDROOM_LED_PIN -1
#endif

#ifndef DEMO_AC_LED_PIN
#define DEMO_AC_LED_PIN -1
#endif

#ifndef BME280_SDA_PIN
#define BME280_SDA_PIN 21
#endif

#ifndef BME280_SCL_PIN
#define BME280_SCL_PIN 22
#endif

const unsigned long CHECK_INTERVAL_MS = 3000;
const unsigned long WIFI_RETRY_INTERVAL_MS = 5000;
const unsigned long WIFI_CONNECT_TIMEOUT_MS = 15000;
const unsigned long HTTP_TIMEOUT_MS = 4000;
const unsigned long DONE_RETRY_INTERVAL_MS = 5000;
const unsigned long INITIAL_STATUS_RETRY_INTERVAL_MS = 5000;
const unsigned long SMART_HOME_ENV_SYNC_INTERVAL_MS = 10000;
const unsigned long SMART_HOME_STATE_SYNC_RETRY_INTERVAL_MS = 5000;
const unsigned long BME280_READ_INTERVAL_MS = 2000;
const unsigned long BME280_RETRY_INTERVAL_MS = 10000;
const uint16_t IR_CAPTURE_BUFFER_SIZE = 1024;
const uint8_t IR_CAPTURE_TIMEOUT_MS = 50;
const uint16_t IR_SEND_RAW_BUFFER_SIZE = 1024;
const int AC_MIN_TEMPERATURE = 16;
const int AC_MAX_TEMPERATURE = 30;
const uint8_t BME280_ADDRESS_PRIMARY = 0x76;
const uint8_t BME280_ADDRESS_SECONDARY = 0x77;
const uint8_t BME280_EXPECTED_CHIP_ID = 0x60;
const uint8_t BME280_MAX_READ_FAILURES = 3;

const char *V2_LIVING_LIGHT_DEVICE_ID = "living_light";
const char *V2_BEDROOM_LIGHT_DEVICE_ID = "bedroom_light";
const char *V2_AIR_CONDITIONER_DEVICE_ID = "air_conditioner";

enum WifiConnectionState
{
  WIFI_DISCONNECTED,
  WIFI_CONNECTING,
  WIFI_CONNECTED
};

bool lightIsOn = false;
SmartHomeState smartHomeState;
WifiConnectionState wifiConnectionState = WIFI_DISCONNECTED;
unsigned long lastCheckAt = 0;
unsigned long wifiConnectStartedAt = 0;
unsigned long lastWifiRetryAt = 0;
unsigned long lastDoneRetryAt = 0;
unsigned long lastInitialStatusSyncAt = 0;
unsigned long lastEnvironmentStatusSyncAt = 0;
unsigned long lastSmartHomeStateSyncAttemptAt = 0;
unsigned long lastBME280ReadAt = 0;
unsigned long lastBME280RetryAt = 0;
bool irLearnMode = false;
unsigned long irLearnStartedAt = 0;
const unsigned long IR_LEARN_TIMEOUT_MS = 30000;
bool initialDeviceStatusPending = true;
bool pendingDoneRetry = false;
uint8_t bme280Address = 0;
uint8_t bme280ReadFailures = 0;
bool environmentValidSampleSyncAttempted = false;
bool smartHomeStateSyncDirty = true;
String lastExecutedCommandId = "";
String pendingDoneCommandId = "";
String pendingDoneResult = "";
String pendingDoneMessage = "";
String pendingLearnCommandId = "";
String pendingLearnKey = "";
String pendingLearnName = "";
String pendingLearnCategory = "";
String pendingLearnDescription = "";
IRrecv irrecv(
    IR_RECEIVE_PIN,
    IR_CAPTURE_BUFFER_SIZE,
    IR_CAPTURE_TIMEOUT_MS,
    true);
IRsend irsend(IR_SEND_PIN);
decode_results irResults;
Adafruit_BME280 bme280;
SmartHomeDisplay smartHomeDisplay;
SmartHomeTouch smartHomeTouch;
SmartHomeFeedback smartHomeFeedback;
unsigned long localTouchCommandSequence = 0;

void connectWiFi()
{
  unsigned long now = millis();

  if (wifiConnectionState == WIFI_CONNECTING)
  {
    return;
  }

  Serial.print("Connecting to Wi-Fi: ");
  Serial.println(WIFI_SSID);
  Serial.println("WiFi CONNECTING");

  smartHomeState.wifiConnected = false;
  smartHomeState.serverConnected = false;
  wifiConnectionState = WIFI_CONNECTING;
  wifiConnectStartedAt = now;
  lastWifiRetryAt = now;

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
}

void updateNetworkState()
{
  unsigned long now = millis();
  wl_status_t wifiStatus = WiFi.status();

  if (wifiStatus == WL_CONNECTED)
  {
    if (wifiConnectionState != WIFI_CONNECTED)
    {
      wifiConnectionState = WIFI_CONNECTED;
      smartHomeState.wifiConnected = true;
      Serial.println("WiFi CONNECTED");
      Serial.print("ESP32 IP: ");
      Serial.println(WiFi.localIP());
    }
    return;
  }

  if (wifiConnectionState == WIFI_CONNECTED)
  {
    Serial.println("WiFi DISCONNECTED");
  }

  smartHomeState.wifiConnected = false;
  smartHomeState.serverConnected = false;

  if (wifiConnectionState == WIFI_CONNECTING)
  {
    if (now - wifiConnectStartedAt >= WIFI_CONNECT_TIMEOUT_MS)
    {
      Serial.println("WiFi DISCONNECTED connect timeout");
      WiFi.disconnect(false);
      wifiConnectionState = WIFI_DISCONNECTED;
      lastWifiRetryAt = now;
    }
    return;
  }

  wifiConnectionState = WIFI_DISCONNECTED;

  if (lastWifiRetryAt == 0 || now - lastWifiRetryAt >= WIFI_RETRY_INTERVAL_MS)
  {
    Serial.println("WiFi RETRY");
    connectWiFi();
  }
}

bool isWifiReadyForBridge()
{
  return WiFi.status() == WL_CONNECTED && smartHomeState.wifiConnected;
}

void updateServerConnectivity(int statusCode)
{
  if (!isWifiReadyForBridge())
  {
    smartHomeState.serverConnected = false;
    return;
  }

  bool reachable = statusCode > 0;
  if (smartHomeState.serverConnected != reachable)
  {
    Serial.println(reachable ? "Server REACHABLE" : "Server TRANSPORT ERROR");
  }
  smartHomeState.serverConnected = reachable;
}

bool isHttpsBridgeUrl(const String &url)
{
  return url.startsWith("https://");
}

bool beginBridgeRequest(
    HTTPClient &http,
    WiFiClientSecure &secureClient,
    const String &url,
    const String &method)
{
  if (isHttpsBridgeUrl(url))
  {
    Serial.print(method);
    Serial.println(" using HTTPS transport");
    secureClient.setInsecure();

    if (!http.begin(secureClient, url))
    {
      Serial.print(method);
      Serial.println(" HTTPS begin failed. Check URL, TLS support, and network.");
      return false;
    }

    return true;
  }

  Serial.print(method);
  Serial.println(" using HTTP transport");

  if (!http.begin(url))
  {
    Serial.print(method);
    Serial.println(" HTTP begin failed. Check Bridge API URL.");
    return false;
  }

  return true;
}

void logBridgeResponse(
    const String &method,
    int statusCode,
    const String &payload,
    bool usingHttps,
    HTTPClient &http)
{
  Serial.print(method);
  Serial.print(" status: ");
  Serial.println(statusCode);

  if (statusCode < 0)
  {
    Serial.print(usingHttps ? "HTTPS " : "HTTP ");
    Serial.print(method);
    Serial.print(" error: ");
    Serial.println(http.errorToString(statusCode));
  }

  Serial.print(method);
  Serial.print(" response: ");
  Serial.println(payload);
}

String httpGetBridge(const String &path)
{
  if (!isWifiReadyForBridge())
  {
    smartHomeState.wifiConnected = false;
    smartHomeState.serverConnected = false;
    return "";
  }

  HTTPClient http;
  WiFiClientSecure secureClient;
  String url = String(BRIDGE_API_URL) + path;
  bool usingHttps = isHttpsBridgeUrl(url);

  Serial.print("GET ");
  Serial.println(url);

  if (!beginBridgeRequest(http, secureClient, url, "GET"))
  {
    updateServerConnectivity(-1);
    return "";
  }

  http.setTimeout(HTTP_TIMEOUT_MS);
  http.addHeader("x-device-token", DEVICE_TOKEN);

  int statusCode = http.GET();
  String payload = http.getString();
  updateServerConnectivity(statusCode);

  logBridgeResponse("GET", statusCode, payload, usingHttps, http);

  http.end();
  return payload;
}

String httpPostBridge(const String &path, const String &jsonBody)
{
  if (!isWifiReadyForBridge())
  {
    smartHomeState.wifiConnected = false;
    smartHomeState.serverConnected = false;
    return "";
  }

  HTTPClient http;
  WiFiClientSecure secureClient;
  String url = String(BRIDGE_API_URL) + path;
  bool usingHttps = isHttpsBridgeUrl(url);

  Serial.print("POST ");
  Serial.println(url);
  Serial.print("POST body: ");
  Serial.println(jsonBody);

  if (!beginBridgeRequest(http, secureClient, url, "POST"))
  {
    updateServerConnectivity(-1);
    return "";
  }

  http.setTimeout(HTTP_TIMEOUT_MS);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("x-device-token", DEVICE_TOKEN);

  int statusCode = http.POST(jsonBody);
  String payload = http.getString();
  updateServerConnectivity(statusCode);

  logBridgeResponse("POST", statusCode, payload, usingHttps, http);

  http.end();
  return payload;
}

int httpPostBridgeStatus(
    const String &path,
    const String &jsonBody,
    String *responsePayload)
{
  if (!isWifiReadyForBridge())
  {
    smartHomeState.wifiConnected = false;
    smartHomeState.serverConnected = false;
    if (responsePayload != nullptr)
    {
      *responsePayload = "";
    }
    return -1;
  }

  HTTPClient http;
  WiFiClientSecure secureClient;
  String url = String(BRIDGE_API_URL) + path;
  bool usingHttps = isHttpsBridgeUrl(url);

  Serial.print("POST ");
  Serial.println(url);
  Serial.print("POST body length: ");
  Serial.println(jsonBody.length());
  Serial.print("POST body: ");
  Serial.println(jsonBody);

  if (!beginBridgeRequest(http, secureClient, url, "POST"))
  {
    updateServerConnectivity(-1);
    if (responsePayload != nullptr)
    {
      *responsePayload = "";
    }
    return -1;
  }

  http.setTimeout(HTTP_TIMEOUT_MS);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("x-device-token", DEVICE_TOKEN);

  int statusCode = http.POST(jsonBody);
  String payload = http.getString();
  updateServerConnectivity(statusCode);

  if (responsePayload != nullptr)
  {
    *responsePayload = payload;
  }

  logBridgeResponse("POST", statusCode, payload, usingHttps, http);
  http.end();
  return statusCode;
}

void printBME280Address(uint8_t address)
{
  Serial.print("0x");
  Serial.print(address, HEX);
}

void clearBME280Readings()
{
  smartHomeState.roomTemperature = NAN;
  smartHomeState.humidity = NAN;
  smartHomeState.pressure = NAN;
}

bool isValidBME280Reading(float temperature, float humidity, float pressureHpa)
{
  return !isnan(temperature) &&
         !isnan(humidity) &&
         !isnan(pressureHpa) &&
         humidity >= 0.0F &&
         humidity <= 100.0F &&
         pressureHpa > 0.0F;
}

bool tryBeginBME280(uint8_t address, bool logProbe)
{
  if (logProbe)
  {
    Serial.print("BME280: probing ");
    printBME280Address(address);
    Serial.println("...");
  }

  if (!bme280.begin(address, &Wire))
  {
    return false;
  }

  uint8_t chipId = bme280.sensorID();
  if (chipId != BME280_EXPECTED_CHIP_ID)
  {
    if (logProbe)
    {
      Serial.print("BME280: unexpected sensor/chip 0x");
      Serial.println(chipId, HEX);
    }
    return false;
  }

  bme280Address = address;
  bme280ReadFailures = 0;
  smartHomeState.bme280Available = true;

  Serial.print("BME280: detected at ");
  printBME280Address(address);
  Serial.println();
  return true;
}

bool probeBME280(bool logProbe)
{
  lastBME280RetryAt = millis();
  smartHomeState.bme280Available = false;
  bme280Address = 0;

  if (tryBeginBME280(BME280_ADDRESS_PRIMARY, logProbe))
  {
    return true;
  }

  if (tryBeginBME280(BME280_ADDRESS_SECONDARY, logProbe))
  {
    return true;
  }

  if (logProbe)
  {
    Serial.println("BME280: NOT FOUND");
  }
  return false;
}

void setupBME280()
{
  clearBME280Readings();
  smartHomeState.bme280Available = false;

  Serial.print("BME280: I2C SDA=");
  Serial.print(BME280_SDA_PIN);
  Serial.print(" SCL=");
  Serial.println(BME280_SCL_PIN);

  Wire.begin(BME280_SDA_PIN, BME280_SCL_PIN);
  probeBME280(true);
}

void markBME280Unavailable()
{
  if (smartHomeState.bme280Available)
  {
    Serial.println("BME280: read failed repeatedly, marking unavailable");
  }

  smartHomeState.bme280Available = false;
  bme280Address = 0;
  clearBME280Readings();
}

void updateBME280(unsigned long now)
{
  if (!smartHomeState.bme280Available)
  {
    if (lastBME280RetryAt == 0 ||
        now - lastBME280RetryAt >= BME280_RETRY_INTERVAL_MS)
    {
      bool recovered = probeBME280(false);
      if (recovered)
      {
        Serial.println("BME280: recovered");
      }
    }
    return;
  }

  if (lastBME280ReadAt != 0 &&
      now - lastBME280ReadAt < BME280_READ_INTERVAL_MS)
  {
    return;
  }
  lastBME280ReadAt = now;

  float temperature = bme280.readTemperature();
  float humidity = bme280.readHumidity();
  // Adafruit_BME280 returns pressure in Pa. SmartHomeState stores hPa for UI.
  float pressureHpa = bme280.readPressure() / 100.0F;

  if (!isValidBME280Reading(temperature, humidity, pressureHpa))
  {
    bme280ReadFailures++;
    if (bme280ReadFailures >= BME280_MAX_READ_FAILURES)
    {
      markBME280Unavailable();
    }
    return;
  }

  if (bme280ReadFailures > 0)
  {
    Serial.println("BME280: read recovered");
  }
  bme280ReadFailures = 0;

  smartHomeState.roomTemperature = temperature;
  smartHomeState.humidity = humidity;
  smartHomeState.pressure = pressureHpa;
}

void setupIR()
{
  irrecv.enableIRIn();
  irsend.begin();
  Serial.println("IR receiver and sender started");
  Serial.print("IR receive pin: ");
  Serial.println(IR_RECEIVE_PIN);
  Serial.print("IR send pin: ");
  Serial.println(IR_SEND_PIN);
}

void clearIRLearnState()
{
  irLearnMode = false;
  pendingLearnCommandId = "";
  pendingLearnKey = "";
  pendingLearnName = "";
  pendingLearnCategory = "";
  pendingLearnDescription = "";
}

String uint64ToHexString(uint64_t value)
{
  if (value == 0)
  {
    return "0x0";
  }

  const char *digits = "0123456789ABCDEF";
  char buffer[19];
  buffer[18] = '\0';
  int index = 17;

  while (value > 0 && index >= 2)
  {
    buffer[index--] = digits[value & 0xF];
    value >>= 4;
  }

  buffer[index--] = 'x';
  buffer[index] = '0';

  return String(&buffer[index]);
}

String jsonEscape(const String &value)
{
  String escaped;
  escaped.reserve(value.length() + 8);

  for (size_t i = 0; i < value.length(); i++)
  {
    char ch = value.charAt(i);

    if (ch == '\\' || ch == '"')
    {
      escaped += '\\';
    }

    escaped += ch;
  }

  return escaped;
}

size_t getLearnedRawDataCount(decode_results &results)
{
  if (results.rawlen <= 1)
  {
    return 0;
  }

  return results.rawlen - 1;
}

String buildRawDataJsonArray(decode_results &results)
{
  size_t rawCount = getLearnedRawDataCount(results);
  Serial.print("IR raw count to save: ");
  Serial.println(rawCount);

  if (rawCount == 0)
  {
    return "[]";
  }

  String rawJson = "[";

  for (uint16_t i = 1; i < results.rawlen; i++)
  {
    uint32_t micros = results.rawbuf[i] * kRawTick;
    rawJson += String(micros);

    if (i + 1 < results.rawlen)
    {
      rawJson += ",";
    }
  }

  rawJson += "]";
  return rawJson;
}

void printIRRawPreview(decode_results &results)
{
  uint16_t previewLength = results.rawlen < 20 ? results.rawlen : 20;

  Serial.print("Raw preview (us): ");

  for (uint16_t i = 0; i < previewLength; i++)
  {
    uint32_t micros = results.rawbuf[i] * kRawTick;
    Serial.print(micros);

    if (i + 1 < previewLength)
    {
      Serial.print(", ");
    }
  }

  Serial.println();
}

bool saveLearnedIRCommand(
    const String &key,
    const String &name,
    const String &category,
    const String &description,
    decode_results &results)
{
  String rawDataJson = buildRawDataJsonArray(results);
  size_t rawCount = getLearnedRawDataCount(results);
  String protocol = typeToString(results.decode_type);
  String valueHex = uint64ToHexString(results.value);

  String body = "{";
  body += "\"deviceId\":\"" + jsonEscape(String(SMART_HOME_DEVICE_ID)) + "\",";
  body += "\"irHubDeviceId\":\"" + jsonEscape(String(IR_HUB_DEVICE_ID)) + "\",";
  body += "\"key\":\"" + jsonEscape(key) + "\",";
  body += "\"name\":\"" + jsonEscape(name) + "\",";
  body += "\"category\":\"" + jsonEscape(category) + "\",";
  body += "\"description\":\"" + jsonEscape(description) + "\",";
  body += "\"protocol\":\"" + jsonEscape(protocol) + "\",";
  body += "\"bits\":" + String(results.bits) + ",";
  body += "\"valueHex\":\"" + jsonEscape(valueHex) + "\",";
  body += "\"rawData\":" + rawDataJson + ",";
  body += "\"rawLength\":" + String(rawCount) + ",";
  body += "\"frequency\":38,";
  body += "\"source\":\"esp32-ir-learn\"";
  body += "}";

  Serial.println("Saving IR command to backend...");
  String responsePayload;
  int statusCode = httpPostBridgeStatus(
      "/api/smart-home/ir-commands",
      body,
      &responsePayload);

  Serial.print("Save status: ");
  Serial.println(statusCode);

  if (statusCode >= 200 && statusCode < 300)
  {
    Serial.println("IR command learned and saved");
    return true;
  }

  Serial.println("IR command save failed");
  Serial.print("Save response: ");
  Serial.println(responsePayload);
  return false;
}

bool fetchIRCommandRawData(
    const String &key,
    uint16_t *rawBuffer,
    uint16_t maxLength,
    uint16_t *outLength,
    uint16_t *outFrequency)
{
  if (rawBuffer == nullptr || outLength == nullptr || outFrequency == nullptr)
  {
    Serial.println("fetchIRCommandRawData received null output pointer");
    return false;
  }

  *outLength = 0;
  *outFrequency = 38;

  if (key == "")
  {
    Serial.println("fetchIRCommandRawData missing key");
    return false;
  }

  String path = "/api/smart-home/ir-commands/" + key;
  Serial.print("Fetching IR command: ");
  Serial.println(path);

  String payload = httpGetBridge(path);
  if (payload == "")
  {
    Serial.println("IR command fetch returned empty payload");
    return false;
  }

  DynamicJsonDocument doc(payload.length() + 2048);
  DeserializationError error = deserializeJson(doc, payload);

  if (error)
  {
    Serial.print("Failed to parse IR command response: ");
    Serial.println(error.c_str());
    return false;
  }

  bool found = doc["found"] | false;
  if (!found)
  {
    Serial.println("IR command not found in backend");
    return false;
  }

  JsonObject command = doc["command"].as<JsonObject>();
  JsonArray rawData = command["rawData"].as<JsonArray>();
  if (rawData.isNull() || rawData.size() == 0)
  {
    Serial.println("IR command rawData is empty");
    return false;
  }

  if (rawData.size() > maxLength)
  {
    Serial.print("IR command rawData too long: ");
    Serial.print(rawData.size());
    Serial.print(" > ");
    Serial.println(maxLength);
    Serial.println("Increase IR_SEND_RAW_BUFFER_SIZE for long IR payloads.");
    return false;
  }

  for (uint16_t i = 0; i < rawData.size(); i++)
  {
    uint32_t value = rawData[i] | 0;
    if (value > 65535)
    {
      Serial.print("IR raw value too large for uint16 at index ");
      Serial.print(i);
      Serial.print(": ");
      Serial.println(value);
      return false;
    }
    rawBuffer[i] = static_cast<uint16_t>(value);
  }

  *outLength = rawData.size();
  *outFrequency = command["frequency"] | 38;

  Serial.print("Fetched IR raw length: ");
  Serial.println(*outLength);
  Serial.print("Fetched IR frequency: ");
  Serial.println(*outFrequency);
  return true;
}

bool sendSavedIRCommand(const String &commandId, const String &key)
{
  uint16_t rawBuffer[IR_SEND_RAW_BUFFER_SIZE];
  uint16_t rawLength = 0;
  uint16_t frequency = 38;

  Serial.println("IR send command received");
  Serial.print("IR send key: ");
  Serial.println(key);

  updateDeviceStatus(IR_HUB_DEVICE_ID, "sending:" + key);

  if (!fetchIRCommandRawData(key, rawBuffer, IR_SEND_RAW_BUFFER_SIZE, &rawLength, &frequency))
  {
    updateDeviceStatus(IR_HUB_DEVICE_ID, "send_failed:" + key);
    markCommandDone(commandId, "ir_command_not_found", "IR command not found or invalid");
    return false;
  }

  const bool isAirconKey = key.startsWith("ac_");
  const uint8_t repeatCount = isAirconKey ? 3 : 1;

  Serial.print("Sending raw IR, rawLength=");
  Serial.print(rawLength);
  Serial.print(" frequency=");
  Serial.println(frequency);

  for (uint8_t repeatIndex = 0; repeatIndex < repeatCount; repeatIndex++)
  {
    if (isAirconKey)
    {
      Serial.print("Sending aircon IR repeat ");
      Serial.print(repeatIndex + 1);
      Serial.print("/");
      Serial.println(repeatCount);
    }

    irsend.sendRaw(rawBuffer, rawLength, frequency);

    if (repeatIndex + 1 < repeatCount)
    {
      delay(300);
    }
  }

  delay(100);

  Serial.println("IR command sent");
  updateDeviceStatus(IR_HUB_DEVICE_ID, "sent:" + key);
  markCommandDone(commandId, "ir_sent", "IR command sent");
  return true;
}

bool updateDeviceStatusDetailed(
    const String &deviceId,
    const String &name,
    const String &type,
    const String &status)
{
  StaticJsonDocument<256> doc;
  doc["deviceId"] = deviceId;
  doc["name"] = name;
  doc["type"] = type;
  doc["status"] = status;
  doc["source"] = SMART_HOME_DEVICE_ID;

  String body;
  serializeJson(doc, body);

  Serial.print("Updating device status: ");
  Serial.print(deviceId);
  Serial.print(" -> ");
  Serial.println(status);

  String responsePayload;
  int statusCode = httpPostBridgeStatus(
      "/api/smart-home/device-status",
      body,
      &responsePayload);
  return statusCode >= 200 && statusCode < 300;
}

bool updateDeviceStatus(const String &deviceId, const String &status)
{
  if (deviceId == LIGHT_DEVICE_ID)
  {
    return updateDeviceStatusDetailed(deviceId, "Den phong khach", "light", status);
  }

  if (deviceId == IR_HUB_DEVICE_ID)
  {
    return updateDeviceStatusDetailed(deviceId, "IR Hub", "ir_hub", status);
  }

  return updateDeviceStatusDetailed(deviceId, "Unknown Device", "unknown", status);
}

bool hasValidSmartHomeEnvironmentSample()
{
  return smartHomeState.bme280Available &&
         isValidBME280Reading(
             smartHomeState.roomTemperature,
             smartHomeState.humidity,
             smartHomeState.pressure);
}

void logSmartHomeStateSnapshot(const char *heading)
{
  Serial.println(heading);
  Serial.print("living=");
  Serial.print(smartHomeState.livingLight ? 1 : 0);
  Serial.print(" bedroom=");
  Serial.print(smartHomeState.bedroomLight ? 1 : 0);
  Serial.print(" ac=");
  Serial.print(smartHomeState.acPower ? 1 : 0);
  Serial.print(" temp=");
  Serial.println(smartHomeState.acSetTemperature);
}

bool updateSmartHomeEnvironmentStatus()
{
  bool hasValidSample = hasValidSmartHomeEnvironmentSample();

  StaticJsonDocument<512> doc;
  doc["deviceId"] = SMART_HOME_DEVICE_ID;
  doc["name"] = "Smart Home Bridge";
  doc["type"] = "smart_home";
  doc["status"] = "online";
  doc["source"] = SMART_HOME_DEVICE_ID;

  JsonObject smartHome = doc.createNestedObject("smartHome");
  smartHome["livingLight"] = smartHomeState.livingLight;
  smartHome["bedroomLight"] = smartHomeState.bedroomLight;
  smartHome["acPower"] = smartHomeState.acPower;
  smartHome["acSetTemperature"] = smartHomeState.acSetTemperature;

  JsonObject environment = doc.createNestedObject("environment");
  environment["sensorAvailable"] = hasValidSample;
  if (hasValidSample)
  {
    environment["temperature"] = smartHomeState.roomTemperature;
    environment["humidity"] = smartHomeState.humidity;
    environment["pressure"] = smartHomeState.pressure;
  }

  String body;
  serializeJson(doc, body);

  if (hasValidSample)
  {
    Serial.println("Smart Home environment sync:");
    Serial.print("temp=");
    Serial.println(smartHomeState.roomTemperature, 1);
    Serial.print("humidity=");
    Serial.println(smartHomeState.humidity, 0);
    Serial.print("pressure=");
    Serial.println(smartHomeState.pressure, 0);
  }
  else
  {
    Serial.println("BME280 unavailable, syncing sensorAvailable=false");
  }

  logSmartHomeStateSnapshot("SmartHome state sync:");
  Serial.println("POST /api/smart-home/device-status");

  String responsePayload;
  int statusCode = httpPostBridgeStatus(
      "/api/smart-home/device-status",
      body,
      &responsePayload);
  Serial.print("status=");
  Serial.println(statusCode);

  return statusCode >= 200 && statusCode < 300;
}

void syncSmartHomeEnvironmentStatus(unsigned long now)
{
  if (!isWifiReadyForBridge())
  {
    return;
  }

  bool hasValidSample = hasValidSmartHomeEnvironmentSample();
  bool immediateSyncPending = smartHomeStateSyncDirty ||
                              (hasValidSample && !environmentValidSampleSyncAttempted);
  bool immediateSyncDue = immediateSyncPending &&
                          (lastSmartHomeStateSyncAttemptAt == 0 ||
                           now - lastSmartHomeStateSyncAttemptAt >= SMART_HOME_STATE_SYNC_RETRY_INTERVAL_MS);
  bool periodicSyncDue = lastEnvironmentStatusSyncAt == 0 ||
                         now - lastEnvironmentStatusSyncAt >= SMART_HOME_ENV_SYNC_INTERVAL_MS;

  if (!immediateSyncDue && !periodicSyncDue)
  {
    return;
  }

  lastSmartHomeStateSyncAttemptAt = now;
  lastEnvironmentStatusSyncAt = now;
  bool syncOk = updateSmartHomeEnvironmentStatus();
  if (syncOk)
  {
    smartHomeStateSyncDirty = false;
    if (hasValidSample)
    {
      environmentValidSampleSyncAttempted = true;
    }
  }
}

bool markCommandDone(const String &commandId, const String &result, const String &message)
{
  if (commandId == "")
  {
    return false;
  }

  StaticJsonDocument<256> doc;
  doc["deviceId"] = SMART_HOME_DEVICE_ID;
  doc["result"] = result;
  doc["message"] = message;

  String body;
  serializeJson(doc, body);

  Serial.print("Marking command done: ");
  Serial.print(commandId);
  Serial.print(" result=");
  Serial.println(result);

  String responsePayload;
  int statusCode = httpPostBridgeStatus(
      "/api/smart-home/commands/" + commandId + "/done",
      body,
      &responsePayload);
  bool doneOk = statusCode >= 200 && statusCode < 300;

  if (doneOk)
  {
    if (pendingDoneRetry && pendingDoneCommandId == commandId)
    {
      pendingDoneRetry = false;
      pendingDoneCommandId = "";
      pendingDoneResult = "";
      pendingDoneMessage = "";
    }
    return true;
  }

  if (statusCode > 0 && statusCode < 500 && statusCode != 408 && statusCode != 429)
  {
    if (pendingDoneRetry && pendingDoneCommandId == commandId)
    {
      pendingDoneRetry = false;
      pendingDoneCommandId = "";
      pendingDoneResult = "";
      pendingDoneMessage = "";
    }
    Serial.println("Command done application error; not retrying");
    return false;
  }

  pendingDoneRetry = true;
  pendingDoneCommandId = commandId;
  pendingDoneResult = result;
  pendingDoneMessage = message;
  Serial.println("Command done pending retry");
  return false;
}

void retryPendingCommandDone(unsigned long now)
{
  if (!pendingDoneRetry)
  {
    return;
  }

  if (!isWifiReadyForBridge())
  {
    return;
  }

  if (now - lastDoneRetryAt < DONE_RETRY_INTERVAL_MS)
  {
    return;
  }

  lastDoneRetryAt = now;
  Serial.print("Retrying command done: ");
  Serial.println(pendingDoneCommandId);
  markCommandDone(pendingDoneCommandId, pendingDoneResult, pendingDoneMessage);
}

void syncInitialDeviceStatus(unsigned long now)
{
  if (!initialDeviceStatusPending)
  {
    return;
  }

  if (!isWifiReadyForBridge())
  {
    return;
  }

  if (lastInitialStatusSyncAt != 0 &&
      now - lastInitialStatusSyncAt < INITIAL_STATUS_RETRY_INTERVAL_MS)
  {
    return;
  }

  lastInitialStatusSyncAt = now;
  Serial.println("Syncing initial device status");
  bool lightStatusOk = updateDeviceStatus(LIGHT_DEVICE_ID, "off");
  bool irHubStatusOk = updateDeviceStatus(IR_HUB_DEVICE_ID, "online");
  initialDeviceStatusPending = !(lightStatusOk && irHubStatusOk);
}

void startIRLearnMode(
    const String &commandId,
    const String &key,
    const String &name,
    const String &category,
    const String &description)
{
  if (irLearnMode == true)
  {
    markCommandDone(commandId, "ir_learn_busy", "IR learn mode is already running");
    return;
  }

  irLearnMode = true;
  irLearnStartedAt = millis();
  pendingLearnCommandId = commandId;
  pendingLearnKey = key;
  pendingLearnName = name;
  pendingLearnCategory = category;
  pendingLearnDescription = description;

  irrecv.resume();
  updateDeviceStatus(IR_HUB_DEVICE_ID, "learning:" + key);

  Serial.println("IR learn started");
  Serial.print("Key: ");
  Serial.println(key);
  Serial.print("Name: ");
  Serial.println(name);
  Serial.println("Please point remote to KY-022 and press a button within 30 seconds");
}

void handleIRLearnMode()
{
  if (irLearnMode == false)
  {
    return;
  }

  if (irrecv.decode(&irResults))
  {
    Serial.println("IR received");
    Serial.print("Protocol: ");
    Serial.println(typeToString(irResults.decode_type));
    Serial.print("Bits: ");
    Serial.println(irResults.bits);
    Serial.print("Value: ");
    Serial.println(uint64ToHexString(irResults.value));
    Serial.print("Raw length: ");
    Serial.println(irResults.rawlen);
    if (irResults.overflow)
    {
      Serial.println("WARNING: IR raw buffer overflow. Increase IR_CAPTURE_BUFFER_SIZE.");
    }
    printIRRawPreview(irResults);

    bool saveOk = saveLearnedIRCommand(
        pendingLearnKey,
        pendingLearnName,
        pendingLearnCategory,
        pendingLearnDescription,
        irResults);

    if (saveOk)
    {
      updateDeviceStatus(IR_HUB_DEVICE_ID, "learned_saved:" + pendingLearnKey);
      markCommandDone(
          pendingLearnCommandId,
          "ir_learned_saved",
          "IR command learned and saved");
    }
    else
    {
      updateDeviceStatus(IR_HUB_DEVICE_ID, "learn_save_failed:" + pendingLearnKey);
      markCommandDone(
          pendingLearnCommandId,
          "ir_learn_save_failed",
          "IR command received but save failed");
    }

    irrecv.resume();
    clearIRLearnState();
    return;
  }

  if (millis() - irLearnStartedAt >= IR_LEARN_TIMEOUT_MS)
  {
    Serial.println("IR learn timeout");
    updateDeviceStatus(IR_HUB_DEVICE_ID, "learn_timeout");
    markCommandDone(pendingLearnCommandId, "ir_learn_timeout", "IR learn timeout");
    clearIRLearnState();
    return;
  }
}

bool isDemoModeEnabled()
{
  return SMART_HOME_DEMO_MODE != 0;
}

bool isDemoPinConfigured(int pin)
{
  return pin >= 0;
}

void writeDemoPin(int pin, bool enabled)
{
  if (!isDemoModeEnabled() || !isDemoPinConfigured(pin))
  {
    return;
  }

  digitalWrite(pin, enabled ? HIGH : LOW);
}

void configureDemoPin(int pin)
{
  if (!isDemoModeEnabled() || !isDemoPinConfigured(pin))
  {
    return;
  }

  pinMode(pin, OUTPUT);
  digitalWrite(pin, LOW);
}

void applyLivingLightOutput()
{
  digitalWrite(LED_PIN, smartHomeState.livingLight ? HIGH : LOW);

  if (DEMO_LIVING_LED_PIN != LED_PIN)
  {
    writeDemoPin(DEMO_LIVING_LED_PIN, smartHomeState.livingLight);
  }
}

void applyBedroomLightOutput()
{
  writeDemoPin(DEMO_BEDROOM_LED_PIN, smartHomeState.bedroomLight);
}

void applyAirConditionerOutput()
{
  writeDemoPin(DEMO_AC_LED_PIN, smartHomeState.acPower);
}

void applyDeviceOutputs()
{
  applyLivingLightOutput();
  applyBedroomLightOutput();
  applyAirConditionerOutput();
}

void setupDeviceOutputs()
{
  pinMode(LED_PIN, OUTPUT);
  configureDemoPin(DEMO_LIVING_LED_PIN);
  configureDemoPin(DEMO_BEDROOM_LED_PIN);
  configureDemoPin(DEMO_AC_LED_PIN);
  applyDeviceOutputs();
}

void logDemoOutputConfiguration()
{
  Serial.print("Smart Home demo mode: ");
  Serial.println(isDemoModeEnabled() ? "enabled" : "disabled");
  Serial.print("Demo living LED pin: ");
  Serial.println(DEMO_LIVING_LED_PIN);
  Serial.print("Demo bedroom LED pin: ");
  Serial.println(DEMO_BEDROOM_LED_PIN);
  Serial.print("Demo AC LED pin: ");
  Serial.println(DEMO_AC_LED_PIN);
}

void markSmartHomeStateDirty()
{
  smartHomeStateSyncDirty = true;
  lastSmartHomeStateSyncAttemptAt = 0;
}

void setLivingLightState(bool enabled)
{
  lightIsOn = enabled;
  smartHomeState.livingLight = enabled;
  applyLivingLightOutput();
  markSmartHomeStateDirty();
}

void setBedroomLightState(bool enabled)
{
  smartHomeState.bedroomLight = enabled;
  applyBedroomLightOutput();
  markSmartHomeStateDirty();
}

void setAirConditionerPower(bool enabled)
{
  smartHomeState.acPower = enabled;
  applyAirConditionerOutput();
  markSmartHomeStateDirty();
}

bool isValidAcTemperature(int temperature)
{
  return temperature >= AC_MIN_TEMPERATURE &&
         temperature <= AC_MAX_TEMPERATURE;
}

int clampAcTemperature(int temperature)
{
  if (temperature < AC_MIN_TEMPERATURE)
  {
    return AC_MIN_TEMPERATURE;
  }

  if (temperature > AC_MAX_TEMPERATURE)
  {
    return AC_MAX_TEMPERATURE;
  }

  return temperature;
}

void setAirConditionerTemperature(int temperature)
{
  int nextTemperature = clampAcTemperature(temperature);
  smartHomeState.acSetTemperature = nextTemperature;
  markSmartHomeStateDirty();
}

void applyIrStateHint(const String &key)
{
  if (key == "ac_cool_26")
  {
    setAirConditionerPower(true);
    setAirConditionerTemperature(26);
    return;
  }

  if (key == "ac_off")
  {
    setAirConditionerPower(false);
    return;
  }
}

bool isV2DeviceId(const String &device)
{
  return device == V2_LIVING_LIGHT_DEVICE_ID ||
         device == V2_BEDROOM_LIGHT_DEVICE_ID ||
         device == V2_AIR_CONDITIONER_DEVICE_ID;
}

String lightResultForDevice(const String &device, bool enabled)
{
  String result = device;
  result += enabled ? "_on" : "_off";
  return result;
}

void dispatchV2LightCommand(const SmartHomeCommand &command)
{
  bool *state = nullptr;

  if (command.device == V2_LIVING_LIGHT_DEVICE_ID)
  {
    state = &smartHomeState.livingLight;
  }
  else if (command.device == V2_BEDROOM_LIGHT_DEVICE_ID)
  {
    state = &smartHomeState.bedroomLight;
  }
  else
  {
    completeCommand(command, "unsupported_device", "Unsupported light device");
    return;
  }

  bool nextState = *state;

  if (command.action == "on")
  {
    nextState = true;
  }
  else if (command.action == "off")
  {
    nextState = false;
  }
  else if (command.action == "toggle")
  {
    nextState = !nextState;
  }
  else
  {
    completeCommand(command, "unsupported_action", "Unsupported light action");
    return;
  }

  if (command.device == V2_LIVING_LIGHT_DEVICE_ID)
  {
    setLivingLightState(nextState);
  }
  else
  {
    setBedroomLightState(nextState);
  }

  logSmartHomeStateSnapshot("SmartHome state:");
  rememberCommandExecution(command);
  notifyCommandSuccess(command);
  completeCommand(
      command,
      lightResultForDevice(command.device, nextState),
      "Light command executed");
}

void dispatchV2AirConditionerCommand(const SmartHomeCommand &command)
{
  String result;

  if (command.action == "on")
  {
    setAirConditionerPower(true);
    result = "ac_on";
  }
  else if (command.action == "off")
  {
    setAirConditionerPower(false);
    result = "ac_off";
  }
  else if (command.action == "toggle")
  {
    setAirConditionerPower(!smartHomeState.acPower);
    result = smartHomeState.acPower ? "ac_on" : "ac_off";
  }
  else if (command.action == "set_temperature")
  {
    if (!command.hasValue)
    {
      completeCommand(command, "missing_temperature", "Missing AC temperature");
      return;
    }

    if (!isValidAcTemperature(command.value))
    {
      completeCommand(command, "invalid_temperature", "Invalid AC temperature");
      return;
    }

    setAirConditionerTemperature(command.value);
    result = String("ac_temperature_") + smartHomeState.acSetTemperature;
  }
  else if (command.action == "temperature_up")
  {
    setAirConditionerTemperature(smartHomeState.acSetTemperature + 1);
    result = String("ac_temperature_") + smartHomeState.acSetTemperature;
  }
  else if (command.action == "temperature_down")
  {
    setAirConditionerTemperature(smartHomeState.acSetTemperature - 1);
    result = String("ac_temperature_") + smartHomeState.acSetTemperature;
  }
  else
  {
    completeCommand(command, "unsupported_action", "Unsupported AC action");
    return;
  }

  logSmartHomeStateSnapshot("SmartHome state:");
  rememberCommandExecution(command);
  notifyCommandSuccess(command);
  completeCommand(command, result, "Air conditioner command executed");
}

void dispatchV2DeviceCommand(const SmartHomeCommand &command)
{
  if (command.device == V2_LIVING_LIGHT_DEVICE_ID ||
      command.device == V2_BEDROOM_LIGHT_DEVICE_ID)
  {
    dispatchV2LightCommand(command);
    return;
  }

  if (command.device == V2_AIR_CONDITIONER_DEVICE_ID)
  {
    dispatchV2AirConditionerCommand(command);
    return;
  }

  completeCommand(command, "unsupported_device", "Unsupported V2 device");
}

bool isDuplicateCommand(const SmartHomeCommand &command)
{
  return command.requiresRemoteAck &&
         command.commandId != "" &&
         (command.commandId == lastExecutedCommandId ||
          (pendingDoneRetry && command.commandId == pendingDoneCommandId));
}

void rememberCommandExecution(const SmartHomeCommand &command)
{
  if (command.requiresRemoteAck && command.commandId != "")
  {
    lastExecutedCommandId = command.commandId;
  }
  smartHomeState.lastCommandAt = millis();
}

void completeCommand(const SmartHomeCommand &command, const String &result, const String &message)
{
  if (command.requiresRemoteAck)
  {
    markCommandDone(command.commandId, result, message);
    return;
  }

  Serial.print("Local command complete: ");
  Serial.print(command.commandId);
  Serial.print(" result=");
  Serial.println(result);
}

void notifyCommandSuccess(const SmartHomeCommand &command)
{
  smartHomeFeedback.notifyCommandSuccess(command.source == "touch");
}

void dispatchCommand(const SmartHomeCommand &command)
{
  Serial.print("Processing command: ");
  Serial.print(command.commandId);
  Serial.print(" type=");
  Serial.print(command.type);
  Serial.print(" device=");
  Serial.print(command.device);
  Serial.print(" action=");
  Serial.println(command.action);

  if (command.type == "device_control" && isV2DeviceId(command.device))
  {
    Serial.println("SmartHome command:");
    Serial.print("device=");
    Serial.println(command.device);
    Serial.print("action=");
    Serial.println(command.action);
  }

  if (isDuplicateCommand(command))
  {
    Serial.println("Duplicate command id skipped");
    if (pendingDoneRetry && command.commandId == pendingDoneCommandId)
    {
      retryPendingCommandDone(millis());
      return;
    }
    completeCommand(command, "duplicate_command", "Duplicate command skipped");
    return;
  }

  if (command.type == "device_control")
  {
    if (isV2DeviceId(command.device))
    {
      dispatchV2DeviceCommand(command);
      return;
    }

    if (command.device != LIGHT_DEVICE_ID)
    {
      Serial.println("Unsupported device");
      completeCommand(command, "unsupported_device", "Unsupported device");
      return;
    }

    String result;

    if (command.action == "on")
    {
      setLivingLightState(true);
      result = "light_on";
      Serial.println("LED turned on");
    }
    else if (command.action == "off")
    {
      setLivingLightState(false);
      result = "light_off";
      Serial.println("LED turned off");
    }
    else if (command.action == "toggle")
    {
      setLivingLightState(!smartHomeState.livingLight);
      result = lightIsOn ? "light_on" : "light_off";
      Serial.println(lightIsOn ? "LED toggled on" : "LED toggled off");
    }
    else
    {
      Serial.println("Unsupported action");
      completeCommand(command, "unsupported_action", "Unsupported light action");
      return;
    }

    updateDeviceStatus(command.device, smartHomeState.livingLight ? "on" : "off");
    rememberCommandExecution(command);
    notifyCommandSuccess(command);
    completeCommand(command, result, "Light command executed");
    return;
  }

  if (command.type == "ir_learn")
  {
    if (command.device != IR_HUB_DEVICE_ID)
    {
      completeCommand(command, "unsupported_device", "Unsupported IR hub device");
      return;
    }

    if (command.action != "start")
    {
      completeCommand(command, "unsupported_action", "Unsupported IR learn action");
      return;
    }

    if (command.key == "")
    {
      completeCommand(command, "missing_ir_key", "Missing IR command key");
      return;
    }

    startIRLearnMode(
        command.commandId,
        command.key,
        command.name,
        command.category,
        command.description);
    rememberCommandExecution(command);
    return;
  }

  if (command.type == "ir_send")
  {
    if (command.device != IR_HUB_DEVICE_ID)
    {
      completeCommand(command, "unsupported_device", "Unsupported IR hub device");
      return;
    }

    if (command.action != "send")
    {
      completeCommand(command, "unsupported_action", "Unsupported IR send action");
      return;
    }

    String resolvedKey = command.irCommandId;
    if (resolvedKey == "")
    {
      resolvedKey = command.key;
    }

    if (resolvedKey == "")
    {
      completeCommand(command, "missing_ir_key", "Missing IR command key");
      return;
    }

    if (sendSavedIRCommand(command.commandId, resolvedKey))
    {
      rememberCommandExecution(command);
      applyIrStateHint(resolvedKey);
      notifyCommandSuccess(command);
    }
    return;
  }

  Serial.println("Unsupported command type");
  completeCommand(command, "unsupported_type", "Unsupported command type");
}

void checkPendingCommand()
{
  if (!isWifiReadyForBridge())
  {
    return;
  }

  Serial.println("Checking pending command");

  String path = String("/api/smart-home/commands/next?deviceId=") + SMART_HOME_DEVICE_ID;
  String payload = httpGetBridge(path);
  if (payload == "")
  {
    return;
  }

  StaticJsonDocument<1024> doc;
  DeserializationError error = deserializeJson(doc, payload);

  if (error)
  {
    Serial.print("Failed to parse command response: ");
    Serial.println(error.c_str());
    return;
  }

  bool hasCommand = doc["hasCommand"] | false;

  if (!hasCommand)
  {
    Serial.println("No pending command");
    return;
  }

  JsonObject command = doc["command"].as<JsonObject>();
  SmartHomeCommand normalizedCommand;
  normalizedCommand.commandId = command["id"] | "";
  if (normalizedCommand.commandId == "")
  {
    normalizedCommand.commandId = command["commandId"] | "";
  }
  normalizedCommand.source = command["source"] | "";
  normalizedCommand.type = command["type"] | "";
  normalizedCommand.device = command["device"] | "";
  normalizedCommand.action = command["action"] | "";
  normalizedCommand.irCommandId = command["irCommandId"] | "";
  normalizedCommand.key = command["key"] | "";
  normalizedCommand.name = command["name"] | "";
  normalizedCommand.category = command["category"] | "";
  normalizedCommand.description = command["description"] | "";
  JsonVariant value = command["value"];
  if (!value.isNull())
  {
    normalizedCommand.hasValue = value.is<int>() ||
                                 value.is<long>() ||
                                 value.is<float>() ||
                                 value.is<double>();
    if (normalizedCommand.hasValue)
    {
      normalizedCommand.value = value.as<int>();
    }
  }

  if (normalizedCommand.commandId == "")
  {
    Serial.println("Command response missing id");
    return;
  }

  Serial.print("Received command id: ");
  Serial.println(normalizedCommand.commandId);

  dispatchCommand(normalizedCommand);
}

SmartHomeCommand createTouchCommand(const SmartHomeTouchEvent &event)
{
  localTouchCommandSequence++;

  SmartHomeCommand command;
  command.commandId = String("touch_") + localTouchCommandSequence + "_" + millis();
  command.source = "touch";
  command.type = "device_control";
  command.device = event.device;
  command.action = event.action;
  command.requiresRemoteAck = false;
  return command;
}

void handleTouchEvent(const SmartHomeTouchEvent &event)
{
  if (event.type == TOUCH_EVENT_NAVIGATION)
  {
    smartHomeDisplay.setPage(event.page);
    smartHomeFeedback.notifyNavigation();
    return;
  }

  if (event.type != TOUCH_EVENT_COMMAND)
  {
    return;
  }

  SmartHomeCommand command = createTouchCommand(event);
  Serial.print("Touch command: ");
  Serial.print(command.device);
  Serial.print(" ");
  Serial.println(command.action);
  dispatchCommand(command);
}

void updateSmartHomeTouch(unsigned long now)
{
  SmartHomeTouchEvent event;
  if (smartHomeTouch.update(now, smartHomeDisplay.page(), &event))
  {
    handleTouchEvent(event);
  }
}

void setup()
{
  Serial.begin(115200);
  delay(1000);

  smartHomeFeedback.begin();
  smartHomeDisplay.begin();
  smartHomeDisplay.showBootStatus("Wi-Fi", "...");
  smartHomeDisplay.showBootStatus("BME280", "...");
  smartHomeDisplay.showBootStatus("System", "...");

  smartHomeState.livingLight = false;
  smartHomeState.bedroomLight = false;
  smartHomeState.acPower = false;
  smartHomeState.acSetTemperature = 26;
  lightIsOn = false;
  setupDeviceOutputs();
  setupIR();
  smartHomeTouch.begin();
  smartHomeDisplay.showBootStatus("System", "OK");
  setupBME280();
  smartHomeDisplay.showBootStatus("BME280", smartHomeState.bme280Available ? "OK" : "NOT FOUND");

  Serial.println("TsunagariCare Smart Home Bridge Demo");
  logDemoOutputConfiguration();
  connectWiFi();
  smartHomeDisplay.showBootStatus("Wi-Fi", "CONNECTING");
  smartHomeDisplay.update(millis(), smartHomeState);
}

void loop()
{
  unsigned long now = millis();

  updateNetworkState();
  handleIRLearnMode();
  updateBME280(now);
  syncSmartHomeEnvironmentStatus(now);
  syncInitialDeviceStatus(now);
  retryPendingCommandDone(now);
  updateSmartHomeTouch(now);

  if (!irLearnMode && now - lastCheckAt >= CHECK_INTERVAL_MS)
  {
    lastCheckAt = now;
    checkPendingCommand();
  }

  smartHomeFeedback.update(now, smartHomeState);
  smartHomeDisplay.update(now, smartHomeState);
}
