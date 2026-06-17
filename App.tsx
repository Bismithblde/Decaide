import { StatusBar } from "expo-status-bar";
import Constants from "expo-constants";
import { useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  Image,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import * as ImagePicker from "expo-image-picker";

type PickedMenuImage = {
  uri: string;
  base64: string;
  mimeType: string;
};

type OcrResult = {
  text: string;
  foodItems: MenuFoodItem[];
  debugFoodItemNames: string;
  confidence: "high" | "medium" | "low";
  warnings: string[];
  uncertainText: string[];
};

type MenuFoodItem = {
  name: string;
  description: string;
  price: string;
};

function getApiBaseUrl() {
  if (process.env.EXPO_PUBLIC_API_URL) {
    return process.env.EXPO_PUBLIC_API_URL;
  }

  const hostUri =
    Constants.expoConfig?.hostUri ||
    Constants.manifest2?.extra?.expoClient?.hostUri;
  const host = typeof hostUri === "string" ? hostUri.split(":")[0] : "";

  if (host && host !== "localhost" && host !== "127.0.0.1") {
    return `http://${host}:3000`;
  }

  return Platform.OS === "android"
    ? "http://10.0.2.2:3000"
    : "http://localhost:3000";
}

const API_BASE_URL = getApiBaseUrl();
const CASE_ROLL_EASING_GRAPH = [
  { time: 0, value: 0 },
  { time: 0.45, value: 0.76 },
  { time: 0.72, value: 0.92 },
  { time: 0.9, value: 0.985 },
  { time: 1, value: 1 },
];

function caseRollEasing(progress: number) {
  for (let index = 1; index < CASE_ROLL_EASING_GRAPH.length; index += 1) {
    const previous = CASE_ROLL_EASING_GRAPH[index - 1];
    const next = CASE_ROLL_EASING_GRAPH[index];

    if (progress <= next.time) {
      const localProgress =
        (progress - previous.time) / (next.time - previous.time);

      return (
        previous.value + (next.value - previous.value) * localProgress
      );
    }
  }

  return 1;
}

function pickRandomItem(items: string[]) {
  if (items.length === 0) {
    return "";
  }

  return items[Math.floor(Math.random() * items.length)];
}

function buildCaseSequence(items: string[], winner: string) {
  const sequence = [winner];

  for (let index = 0; index < 28; index += 1) {
    sequence.push(pickRandomItem(items));
  }

  return sequence;
}

export default function App() {
  const [image, setImage] = useState<PickedMenuImage | null>(null);
  const [result, setResult] = useState<OcrResult | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [storeName, setStoreName] = useState("");
  const [location, setLocation] = useState("");
  const [selectedFood, setSelectedFood] = useState("");
  const [caseVisible, setCaseVisible] = useState(false);
  const [caseDone, setCaseDone] = useState(false);
  const [rollingFoods, setRollingFoods] = useState<string[]>([]);
  const overlayOpacity = useRef(new Animated.Value(0)).current;
  const rollProgress = useRef(new Animated.Value(0)).current;
  const finalScale = useRef(new Animated.Value(0.94)).current;

  const foodNames = useMemo(
    () => (result?.foodItems || []).map((item) => item.name).filter(Boolean),
    [result],
  );
  const rollTranslateY = rollProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [76 - Math.max(rollingFoods.length - 1, 0) * 44, 76],
  });
  const finalItemStyle = {
    transform: [
      {
        scale: finalScale,
      },
    ],
  };

  const statusText = useMemo(() => {
    if (isSubmitting) {
      return "Reading menu text";
    }

    if (result) {
      return `OCR confidence: ${result.confidence}`;
    }

    if (image) {
      return "Image ready";
    }

    return "No menu selected";
  }, [image, isSubmitting, result]);

  const openCase = (items = foodNames) => {
    const nextFood = pickRandomItem(items);

    if (!nextFood) {
      return;
    }

    setSelectedFood(nextFood);
    setRollingFoods(buildCaseSequence(items, nextFood));
    setCaseVisible(true);
    setCaseDone(false);
    overlayOpacity.setValue(0);
    rollProgress.setValue(0);
    finalScale.setValue(0.94);

    Animated.sequence([
      Animated.timing(overlayOpacity, {
        toValue: 1,
        duration: 180,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(rollProgress, {
        toValue: 1,
        duration: 3400,
        easing: caseRollEasing,
        useNativeDriver: true,
      }),
    ]).start(() => {
      setCaseDone(true);
      Animated.spring(finalScale, {
        toValue: 1,
        friction: 5,
        tension: 95,
        useNativeDriver: true,
      }).start();
    });
  };

  const closeCase = () => {
    Animated.timing(overlayOpacity, {
      toValue: 0,
      duration: 160,
      easing: Easing.in(Easing.quad),
      useNativeDriver: true,
    }).start(() => {
      setCaseVisible(false);
      setCaseDone(false);
      setRollingFoods([]);
    });
  };

  const selectImage = async (source: "camera" | "gallery") => {
    setError(null);
    setResult(null);
    setSelectedFood("");
    setCaseVisible(false);
    setCaseDone(false);
    setRollingFoods([]);

    const permission =
      source === "camera"
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (!permission.granted) {
      Alert.alert(
        "Permission needed",
        source === "camera"
          ? "Camera access is required."
          : "Photo access is required.",
      );
      return;
    }

    const pickerOptions: ImagePicker.ImagePickerOptions = {
      mediaTypes: ["images"],
      allowsEditing: false,
      base64: true,
      quality: 0.92,
    };
    const pickerResult =
      source === "camera"
        ? await ImagePicker.launchCameraAsync(pickerOptions)
        : await ImagePicker.launchImageLibraryAsync(pickerOptions);

    if (pickerResult.canceled) {
      return;
    }

    const asset = pickerResult.assets[0];

    if (!asset?.base64) {
      setError(
        "The selected image did not include base64 data. Try again with a different image.",
      );
      return;
    }

    setImage({
      uri: asset.uri,
      base64: asset.base64,
      mimeType: asset.mimeType || "image/jpeg",
    });
  };

  const submitImage = async () => {
    if (!image) {
      setError("Take or choose a menu image first.");
      return;
    }

    setIsSubmitting(true);
    setError(null);
    setResult(null);
    setSelectedFood("");
    setCaseVisible(false);
    setCaseDone(false);
    setRollingFoods([]);

    try {
      const response = await fetch(`${API_BASE_URL}/api/menu/ocr`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          imageBase64: image.base64,
          mimeType: image.mimeType,
          storeName,
          location,
        }),
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.message || "Menu OCR failed.");
      }

      console.log("menu OCR payload foodItems", payload.foodItems);

      const foodItems: MenuFoodItem[] = Array.isArray(payload.foodItems)
        ? payload.foodItems
        : [];

      setResult({
        text: payload.text || "",
        foodItems,
        debugFoodItemNames:
          foodItems.map((item) => item?.name).filter(Boolean).join(", ") ||
          "none",
        confidence: payload.confidence || "low",
        warnings: Array.isArray(payload.warnings) ? payload.warnings : [],
        uncertainText: Array.isArray(payload.uncertainText)
          ? payload.uncertainText
          : [],
      });
    } catch (submitError) {
      const message =
        submitError instanceof Error ? submitError.message : "Menu OCR failed.";
      setError(`${message} Backend URL: ${API_BASE_URL}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="light" />
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.nav}>
          <Text style={styles.brand}>Decaide</Text>
          <View style={styles.statusPill}>
            <View
              style={[
                styles.statusDot,
                result ? styles.statusDotActive : undefined,
              ]}
            />
            <Text style={styles.statusText}>{statusText}</Text>
          </View>
        </View>

        <View style={styles.hero}>
          <View style={styles.heroCopy}>
            <Text style={styles.title}>
              Photograph a menu. Pull out the text.
            </Text>
            <Text style={styles.subtitle}>
              A small test bench for the menu OCR route: take a fresh photo or
              choose a saved menu, then send it to the backend.
            </Text>
          </View>

          <View style={styles.actions}>
            <Pressable
              style={({ pressed }) => [
                styles.primaryButton,
                pressed && styles.buttonPressed,
              ]}
              onPress={() => selectImage("camera")}
            >
              <Text style={styles.primaryButtonText}>Open camera</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [
                styles.secondaryButton,
                pressed && styles.buttonPressed,
              ]}
              onPress={() => selectImage("gallery")}
            >
              <Text style={styles.secondaryButtonText}>Choose photo</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.previewPanel}>
          {image ? (
            <Image
              source={{ uri: image.uri }}
              style={styles.previewImage}
              resizeMode="cover"
            />
          ) : (
            <View style={styles.emptyPreview}>
              <Text style={styles.emptyTitle}>Menu preview</Text>
              <Text style={styles.emptyText}>
                Use the camera button or gallery picker to load a test image.
              </Text>
            </View>
          )}
        </View>

        <View style={styles.detailsPanel}>
          <Text style={styles.detailsTitle}>Optional online match</Text>
          <TextInput
            autoCapitalize="words"
            onChangeText={setStoreName}
            placeholder="Store name"
            placeholderTextColor="#8F8776"
            style={styles.input}
            value={storeName}
          />
          <TextInput
            autoCapitalize="words"
            onChangeText={setLocation}
            placeholder="Location or address"
            placeholderTextColor="#8F8776"
            style={styles.input}
            value={location}
          />
        </View>

        <Pressable
          disabled={!image || isSubmitting}
          style={({ pressed }) => [
            styles.submitButton,
            (!image || isSubmitting) && styles.submitButtonDisabled,
            pressed && image && !isSubmitting && styles.buttonPressed,
          ]}
          onPress={submitImage}
        >
          {isSubmitting ? (
            <ActivityIndicator color="#F9F6EF" />
          ) : (
            <Text style={styles.submitButtonText}>Extract menu text</Text>
          )}
        </Pressable>

        {error ? (
          <View style={styles.errorPanel}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        {result ? (
          <View style={styles.resultPanel}>
            <View style={styles.resultHeader}>
              <Text style={styles.resultTitle}>Food names</Text>
              <Text style={styles.confidence}>{result.confidence}</Text>
            </View>
            <Text style={styles.debugText}>
              Backend items: {result.debugFoodItemNames}
            </Text>
            {foodNames.length > 0 ? (
              <View style={styles.foodList}>
                {foodNames.map((foodName) => (
                  <View key={foodName} style={styles.foodChip}>
                    <Text style={styles.foodChipText}>{foodName}</Text>
                  </View>
                ))}
              </View>
            ) : (
              <Text style={styles.resultText}>No food names were found.</Text>
            )}

            <Pressable
              disabled={foodNames.length === 0}
              style={({ pressed }) => [
                styles.drawButton,
                foodNames.length === 0 && styles.drawButtonDisabled,
                pressed && foodNames.length > 0 && styles.buttonPressed,
              ]}
              onPress={() => openCase()}
            >
              <Text style={styles.drawButtonText}>Open case</Text>
            </Pressable>
            {result.warnings.length > 0 ? (
              <Text style={styles.noteText}>{result.warnings.join(" ")}</Text>
            ) : null}
            {result.uncertainText.length > 0 ? (
              <Text style={styles.noteText}>
                Uncertain: {result.uncertainText.join(", ")}
              </Text>
            ) : null}
          </View>
        ) : null}
      </ScrollView>
      {caseVisible ? (
        <Animated.View
          pointerEvents="auto"
          style={[styles.caseOverlay, { opacity: overlayOpacity }]}
        >
          <View style={styles.caseStage}>
            <Text style={styles.caseTitle}>Opening Case</Text>
            <View style={styles.caseWindow}>
              <Animated.View
                style={[
                  styles.caseRoll,
                  {
                    transform: [{ translateY: rollTranslateY }],
                  },
                ]}
              >
                {rollingFoods.map((foodName, index) => (
                  <Text
                    key={`${foodName}-${index}`}
                    numberOfLines={1}
                    style={styles.caseRollText}
                  >
                    {foodName}
                  </Text>
                ))}
              </Animated.View>
              <View style={styles.caseCenterLine} />
              {caseDone ? (
                <Animated.View style={[styles.caseWinner, finalItemStyle]}>
                  <Text style={styles.caseWinnerLabel}>Picked</Text>
                  <Text numberOfLines={3} style={styles.caseWinnerText}>
                    {selectedFood}
                  </Text>
                </Animated.View>
              ) : null}
            </View>
            {caseDone ? (
              <Pressable
                style={({ pressed }) => [
                  styles.caseCloseButton,
                  pressed && styles.buttonPressed,
                ]}
                onPress={closeCase}
              >
                <Text style={styles.caseCloseText}>Close</Text>
              </Pressable>
            ) : null}
          </View>
        </Animated.View>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#141412",
  },
  content: {
    paddingHorizontal: 20,
    paddingBottom: 36,
  },
  nav: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    paddingTop: 12,
    paddingBottom: 28,
  },
  brand: {
    color: "#F9F6EF",
    fontFamily: Platform.select({ ios: "Georgia", default: "serif" }),
    fontSize: 24,
    letterSpacing: 0,
  },
  statusPill: {
    alignItems: "center",
    backgroundColor: "#26231D",
    borderColor: "#3A352C",
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  statusDot: {
    backgroundColor: "#8F8776",
    borderRadius: 999,
    height: 7,
    width: 7,
  },
  statusDotActive: {
    backgroundColor: "#A7E8BD",
  },
  statusText: {
    color: "#D7D0C2",
    fontSize: 12,
    fontWeight: "700",
  },
  hero: {
    backgroundColor: "#F2EADD",
    borderRadius: 28,
    overflow: "hidden",
    padding: 22,
  },
  heroCopy: {
    gap: 14,
  },
  title: {
    color: "#171512",
    fontSize: 42,
    fontWeight: "900",
    letterSpacing: 0,
    lineHeight: 43,
  },
  subtitle: {
    color: "#5D5548",
    fontSize: 16,
    fontWeight: "600",
    lineHeight: 23,
  },
  actions: {
    flexDirection: "row",
    gap: 10,
    marginTop: 26,
  },
  primaryButton: {
    alignItems: "center",
    backgroundColor: "#171512",
    borderRadius: 18,
    flex: 1,
    minHeight: 54,
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  primaryButtonText: {
    color: "#F9F6EF",
    fontSize: 15,
    fontWeight: "900",
  },
  secondaryButton: {
    alignItems: "center",
    backgroundColor: "#D7CDBA",
    borderRadius: 18,
    flex: 1,
    minHeight: 54,
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  secondaryButtonText: {
    color: "#171512",
    fontSize: 15,
    fontWeight: "900",
  },
  buttonPressed: {
    opacity: 0.72,
    transform: [{ scale: 0.98 }],
  },
  previewPanel: {
    backgroundColor: "#22201C",
    borderColor: "#383229",
    borderRadius: 26,
    borderWidth: 1,
    height: 340,
    marginTop: 18,
    overflow: "hidden",
  },
  previewImage: {
    height: "100%",
    width: "100%",
  },
  emptyPreview: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
    padding: 28,
  },
  emptyTitle: {
    color: "#F2EADD",
    fontSize: 22,
    fontWeight: "900",
    marginBottom: 10,
  },
  emptyText: {
    color: "#AFA697",
    fontSize: 15,
    fontWeight: "600",
    lineHeight: 22,
    textAlign: "center",
  },
  detailsPanel: {
    backgroundColor: "#22201C",
    borderColor: "#383229",
    borderRadius: 22,
    borderWidth: 1,
    gap: 10,
    marginTop: 14,
    padding: 14,
  },
  detailsTitle: {
    color: "#F2EADD",
    fontSize: 14,
    fontWeight: "900",
  },
  input: {
    backgroundColor: "#171512",
    borderColor: "#383229",
    borderRadius: 16,
    borderWidth: 1,
    color: "#F9F6EF",
    fontSize: 15,
    fontWeight: "700",
    minHeight: 50,
    paddingHorizontal: 14,
  },
  submitButton: {
    alignItems: "center",
    backgroundColor: "#B65E3B",
    borderRadius: 20,
    justifyContent: "center",
    marginTop: 14,
    minHeight: 58,
  },
  submitButtonDisabled: {
    backgroundColor: "#564D42",
  },
  submitButtonText: {
    color: "#F9F6EF",
    fontSize: 16,
    fontWeight: "900",
  },
  errorPanel: {
    backgroundColor: "#3A1F1A",
    borderColor: "#7B3B2D",
    borderRadius: 18,
    borderWidth: 1,
    marginTop: 14,
    padding: 16,
  },
  errorText: {
    color: "#FFD8CD",
    fontSize: 14,
    fontWeight: "700",
    lineHeight: 20,
  },
  resultPanel: {
    backgroundColor: "#F9F6EF",
    borderRadius: 24,
    marginTop: 18,
    padding: 18,
  },
  resultHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  resultTitle: {
    color: "#171512",
    fontSize: 20,
    fontWeight: "900",
  },
  confidence: {
    backgroundColor: "#171512",
    borderRadius: 999,
    color: "#F9F6EF",
    fontSize: 12,
    fontWeight: "900",
    overflow: "hidden",
    paddingHorizontal: 10,
    paddingVertical: 6,
    textTransform: "uppercase",
  },
  resultText: {
    color: "#24211C",
    fontSize: 15,
    fontWeight: "600",
    lineHeight: 22,
  },
  debugText: {
    color: "#7A6B58",
    fontSize: 12,
    fontWeight: "800",
    lineHeight: 17,
    marginBottom: 12,
  },
  foodList: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  foodChip: {
    backgroundColor: "#E6DDCD",
    borderColor: "#D3C5AE",
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  foodChipText: {
    color: "#24211C",
    fontSize: 13,
    fontWeight: "900",
  },
  drawButton: {
    alignItems: "center",
    backgroundColor: "#171512",
    borderRadius: 16,
    justifyContent: "center",
    marginTop: 12,
    minHeight: 48,
  },
  drawButtonDisabled: {
    backgroundColor: "#8F8776",
  },
  drawButtonText: {
    color: "#F9F6EF",
    fontSize: 14,
    fontWeight: "900",
  },
  caseOverlay: {
    alignItems: "center",
    backgroundColor: "rgba(10, 9, 8, 0.9)",
    bottom: 0,
    justifyContent: "center",
    left: 0,
    padding: 24,
    position: "absolute",
    right: 0,
    top: 0,
  },
  caseStage: {
    alignItems: "center",
    width: "100%",
  },
  caseTitle: {
    color: "#F9F6EF",
    fontSize: 14,
    fontWeight: "900",
    letterSpacing: 0,
    marginBottom: 16,
    textTransform: "uppercase",
  },
  caseWindow: {
    alignItems: "center",
    backgroundColor: "#171512",
    borderColor: "#B65E3B",
    borderRadius: 8,
    borderWidth: 2,
    height: 190,
    justifyContent: "center",
    overflow: "hidden",
    shadowColor: "#000000",
    shadowOffset: {
      height: 12,
      width: 0,
    },
    shadowOpacity: 0.32,
    shadowRadius: 24,
    width: 190,
  },
  caseRoll: {
    left: 12,
    position: "absolute",
    right: 12,
    top: 0,
  },
  caseRollText: {
    color: "#D7CDBA",
    fontSize: 15,
    fontWeight: "900",
    height: 44,
    lineHeight: 44,
    textAlign: "center",
  },
  caseCenterLine: {
    backgroundColor: "rgba(249, 246, 239, 0.14)",
    height: 46,
    left: 8,
    position: "absolute",
    right: 8,
    top: 72,
  },
  caseWinner: {
    alignItems: "center",
    backgroundColor: "#F9F6EF",
    borderColor: "#D7CDBA",
    borderRadius: 6,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 108,
    paddingHorizontal: 14,
    position: "absolute",
    width: 150,
  },
  caseWinnerLabel: {
    color: "#B65E3B",
    fontSize: 11,
    fontWeight: "900",
    marginBottom: 7,
    textTransform: "uppercase",
  },
  caseWinnerText: {
    color: "#171512",
    fontSize: 21,
    fontWeight: "900",
    lineHeight: 25,
    textAlign: "center",
  },
  caseCloseButton: {
    alignItems: "center",
    backgroundColor: "#F9F6EF",
    borderRadius: 16,
    justifyContent: "center",
    marginTop: 18,
    minHeight: 50,
    paddingHorizontal: 26,
  },
  caseCloseText: {
    color: "#171512",
    fontSize: 14,
    fontWeight: "900",
  },
  noteText: {
    color: "#6A5C4C",
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 19,
    marginTop: 14,
  },
});
