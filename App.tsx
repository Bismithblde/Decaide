import { StatusBar } from "expo-status-bar";
import Constants from "expo-constants";
import { useMemo, useRef, useState } from "react";
import { BlurView } from "expo-blur";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  Image as RNImage,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import Ionicons from "@expo/vector-icons/Ionicons";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";

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

const SAMPLE_ITEMS: MenuFoodItem[] = [
  { name: "Charred Heirloom Tomato", description: "veg", price: "$14" },
  { name: "Wood-Fired Focaccia", description: "share", price: "$9" },
  { name: "Saffron Risotto", description: "chef's", price: "$24" },
  { name: "Grilled Branzino", description: "fish", price: "$32" },
  { name: "Pistachio Olive Cake", description: "sweet", price: "$11" },
];

function caseRollEasing(progress: number) {
  for (let index = 1; index < CASE_ROLL_EASING_GRAPH.length; index += 1) {
    const previous = CASE_ROLL_EASING_GRAPH[index - 1];
    const next = CASE_ROLL_EASING_GRAPH[index];

    if (progress <= next.time) {
      const localProgress =
        (progress - previous.time) / (next.time - previous.time);

      return previous.value + (next.value - previous.value) * localProgress;
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

function normalizeDish(item: MenuFoodItem, index: number) {
  const fallback = SAMPLE_ITEMS[index % SAMPLE_ITEMS.length];
  const label = (item.description || fallback.description || "menu")
    .split(/[,.]/)[0]
    .trim()
    .slice(0, 7);

  return {
    name: item.name || fallback.name,
    price: item.price || fallback.price,
    tag: label || fallback.description,
  };
}

export default function App() {
  const [image, setImage] = useState<PickedMenuImage | null>(null);
  const [result, setResult] = useState<OcrResult | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedFood, setSelectedFood] = useState("");
  const [caseVisible, setCaseVisible] = useState(false);
  const [caseDone, setCaseDone] = useState(false);
  const [rollingFoods, setRollingFoods] = useState<string[]>([]);
  const [sheetVisible, setSheetVisible] = useState(false);
  const overlayOpacity = useRef(new Animated.Value(0)).current;
  const rollProgress = useRef(new Animated.Value(0)).current;
  const finalScale = useRef(new Animated.Value(0.94)).current;
  const sheetProgress = useRef(new Animated.Value(0)).current;

  const parsedItems = useMemo(
    () =>
      result?.foodItems.length
        ? result.foodItems.slice(0, 5).map(normalizeDish)
        : [],
    [result],
  );
  const foodNames = useMemo(
    () => parsedItems.map((item) => item.name).filter(Boolean),
    [parsedItems],
  );
  const rollTranslateY = rollProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [76 - Math.max(rollingFoods.length - 1, 0) * 44, 76],
  });
  const finalItemStyle = {
    transform: [{ scale: finalScale }],
  };
  const animatedSheetStyle = {
    opacity: sheetProgress,
    transform: [
      {
        translateY: sheetProgress.interpolate({
          inputRange: [0, 1],
          outputRange: [-330, 0],
        }),
      },
    ],
  };
  const animatedBlurStyle = {
    opacity: sheetProgress,
  };
  const animatedDimStyle = {
    opacity: sheetProgress,
  };

  const openSheet = () => {
    sheetProgress.stopAnimation();
    sheetProgress.setValue(0);
    setSheetVisible(true);
    Animated.spring(sheetProgress, {
      toValue: 1,
      damping: 22,
      mass: 0.82,
      stiffness: 235,
      useNativeDriver: false,
    }).start();
  };

  const closeSheet = () => {
    sheetProgress.stopAnimation();
    Animated.timing(sheetProgress, {
      toValue: 0,
      duration: 210,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: false,
    }).start(({ finished }) => {
      if (finished) {
        setSheetVisible(false);
      }
    });
  };

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
    closeSheet();
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
          storeName: "",
          location: "",
        }),
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.message || "Menu OCR failed.");
      }

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

      <View style={styles.screen}>
        {result && image ? (
          <View style={styles.parsedWrap}>
            <View style={styles.photoCard}>
              <RNImage
                source={{ uri: image.uri }}
                style={styles.photoImage}
                resizeMode="cover"
              />
              <Pressable
                accessibilityRole="button"
                style={styles.photoClose}
                onPress={() => {
                  setImage(null);
                  setResult(null);
                  setError(null);
                }}
              >
                <Ionicons name="close" color="#F7F9FB" size={21} />
              </Pressable>
              <View style={styles.readyBadge}>
                <Ionicons name="checkmark" color="#9DC7E5" size={14} />
                <Text style={styles.readyText}>Menu ready</Text>
              </View>
            </View>

            <View style={styles.resultsCard}>
              <View style={styles.resultsHeader}>
                <View style={styles.resultsTitleWrap}>
                  <View style={styles.iconBubbleSmall}>
                    <Ionicons name="sparkles" color="#0B1115" size={21} />
                  </View>
                  <Text style={styles.resultsTitle}>
                    Parsed {parsedItems.length} dishes
                  </Text>
                </View>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => {
                    setResult(null);
                    setImage(null);
                    setError(null);
                    openSheet();
                  }}
                >
                  <Text style={styles.newScanText}>New scan</Text>
                </Pressable>
              </View>

              <View style={styles.dishList}>
                {parsedItems.map((item) => (
                  <View key={`${item.name}-${item.price}`} style={styles.dishRow}>
                    <Text style={styles.dishTag}>{item.tag.toUpperCase()}</Text>
                    <Text numberOfLines={1} style={styles.dishName}>
                      {item.name}
                    </Text>
                    <Text style={styles.dishPrice}>{item.price}</Text>
                  </View>
                ))}
              </View>

              <Pressable
                disabled={foodNames.length === 0}
                style={({ pressed }) => [
                  styles.gambleButton,
                  pressed && foodNames.length > 0 && styles.buttonPressed,
                ]}
                onPress={() => openCase()}
              >
                <MaterialCommunityIcons
                  name="dice-5-outline"
                  color="#071014"
                  size={20}
                />
                <Text style={styles.gambleText}>Can't decide? Gamble</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <View style={styles.uploadWrap}>
            <Pressable
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.uploadBox,
                pressed && styles.uploadBoxPressed,
              ]}
              onPress={openSheet}
            >
              {image ? (
                <>
                  <RNImage
                    source={{ uri: image.uri }}
                    style={styles.uploadPreviewImage}
                    resizeMode="cover"
                  />
                  <View style={styles.uploadReadyBadge}>
                    <Ionicons name="checkmark" color="#9DC7E5" size={14} />
                    <Text style={styles.readyText}>Menu ready</Text>
                  </View>
                </>
              ) : (
                <>
                  <View style={styles.uploadIconCircle}>
                    <Ionicons
                      name="restaurant-outline"
                      color="#9DC7E5"
                      size={34}
                    />
                  </View>
                  <Text style={styles.uploadTitle}>Upload a menu</Text>
                  <Text style={styles.uploadSubtitle}>
                    Tap to take a photo or pick from your gallery
                  </Text>
                </>
              )}
            </Pressable>

            <Pressable
              disabled={!image || isSubmitting}
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.parseButton,
                (!image || isSubmitting) && styles.parseButtonDisabled,
                pressed && image && !isSubmitting && styles.buttonPressed,
              ]}
              onPress={submitImage}
            >
              {isSubmitting ? (
                <ActivityIndicator color="#A2A8B1" />
              ) : (
                <>
                  <Ionicons name="sparkles-outline" color="#AEB3BB" size={21} />
                  <Text style={styles.parseButtonText}>Parse Menu</Text>
                </>
              )}
            </Pressable>

            {error ? <Text style={styles.errorText}>{error}</Text> : null}
          </View>
        )}
      </View>

      <View style={styles.tabBar}>
        <View style={styles.tabItem}>
          <Ionicons name="home-outline" color="#07090B" size={21} />
          <Text style={styles.tabLabelActive}>Home</Text>
        </View>
        <View style={styles.tabItem}>
          <Ionicons name="bookmark-outline" color="#41464E" size={20} />
          <Text style={styles.tabLabel}>Saved</Text>
        </View>
      </View>

      <Modal
        animationType="none"
        onRequestClose={closeSheet}
        transparent
        visible={sheetVisible}
      >
        <View style={styles.sheetBackdrop}>
          <Animated.View style={[styles.sheetBlur, animatedBlurStyle]}>
            <BlurView intensity={42} tint="light" style={styles.sheetBlurFill} />
          </Animated.View>
          <Animated.View style={[styles.sheetDim, animatedDimStyle]} />
          <Pressable
            accessibilityLabel="Close add menu"
            accessibilityRole="button"
            style={styles.sheetDismissLayer}
            onPress={closeSheet}
          />
          <Animated.View style={[styles.sheet, animatedSheetStyle]}>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Add a menu</Text>
              <Pressable
                accessibilityRole="button"
                style={styles.sheetClose}
                onPress={closeSheet}
              >
                <Ionicons name="close" color="#9DA3AA" size={21} />
              </Pressable>
            </View>

            <Pressable
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.sheetOption,
                pressed && styles.buttonPressed,
              ]}
              onPress={() => selectImage("camera")}
            >
              <View style={styles.sheetOptionIconActive}>
                <Ionicons name="camera-outline" color="#9DC7E5" size={21} />
              </View>
              <View>
                <Text style={styles.optionTitle}>Take a photo</Text>
                <Text style={styles.optionSubtitle}>Use your camera</Text>
              </View>
            </Pressable>

            <Pressable
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.sheetOption,
                pressed && styles.buttonPressed,
              ]}
              onPress={() => selectImage("gallery")}
            >
              <View style={styles.sheetOptionIcon}>
                <Ionicons name="image-outline" color="#A4A9B0" size={21} />
              </View>
              <View>
                <Text style={styles.optionTitle}>Choose from gallery</Text>
                <Text style={styles.optionSubtitle}>Pick an existing image</Text>
              </View>
            </Pressable>
          </Animated.View>
        </View>
      </Modal>

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
    backgroundColor: "#07090B",
  },
  screen: {
    alignItems: "center",
    flex: 1,
    paddingHorizontal: 28,
  },
  uploadWrap: {
    alignItems: "center",
    paddingTop: 26,
    width: "100%",
  },
  uploadBox: {
    alignItems: "center",
    backgroundColor: "#17191B",
    borderColor: "#4F6479",
    borderRadius: 41,
    borderStyle: "dashed",
    borderWidth: 1.5,
    height: 325,
    justifyContent: "center",
    maxWidth: 408,
    overflow: "hidden",
    paddingHorizontal: 24,
    width: "100%",
  },
  uploadBoxPressed: {
    opacity: 0.86,
  },
  uploadIconCircle: {
    alignItems: "center",
    backgroundColor: "#25292E",
    borderRadius: 32,
    height: 65,
    justifyContent: "center",
    marginBottom: 18,
    width: 65,
  },
  uploadTitle: {
    color: "#F7F9FB",
    fontSize: 18,
    fontWeight: "900",
    letterSpacing: 0,
    lineHeight: 24,
    marginBottom: 6,
  },
  uploadSubtitle: {
    color: "#A8B7C7",
    fontSize: 14,
    fontWeight: "500",
    letterSpacing: 0,
    lineHeight: 20,
    textAlign: "center",
  },
  uploadPreviewImage: {
    height: "100%",
    left: 0,
    position: "absolute",
    top: 0,
    width: "100%",
  },
  uploadReadyBadge: {
    alignItems: "center",
    backgroundColor: "rgba(37, 41, 42, 0.94)",
    borderRadius: 8,
    bottom: 14,
    flexDirection: "row",
    gap: 7,
    left: 16,
    paddingHorizontal: 9,
    paddingVertical: 8,
    position: "absolute",
  },
  parseButton: {
    alignItems: "center",
    backgroundColor: "#25282C",
    borderRadius: 32,
    flexDirection: "row",
    gap: 10,
    height: 64,
    justifyContent: "center",
    marginTop: 13,
    maxWidth: 408,
    width: "100%",
  },
  parseButtonDisabled: {
    opacity: 0.92,
  },
  parseButtonText: {
    color: "#AEB3BB",
    fontSize: 16,
    fontWeight: "900",
    letterSpacing: 0,
  },
  errorText: {
    color: "#FFC9C9",
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 18,
    marginTop: 14,
    maxWidth: 408,
    textAlign: "center",
  },
  parsedWrap: {
    alignItems: "center",
    paddingTop: 20,
    width: "100%",
  },
  photoCard: {
    backgroundColor: "#17191B",
    borderRadius: 36,
    height: 327,
    maxWidth: 454,
    overflow: "hidden",
    width: "100%",
  },
  photoImage: {
    height: "100%",
    opacity: 0.74,
    width: "100%",
  },
  photoClose: {
    alignItems: "center",
    backgroundColor: "#22262A",
    borderRadius: 20,
    height: 38,
    justifyContent: "center",
    position: "absolute",
    right: 15,
    top: 14,
    width: 38,
  },
  readyBadge: {
    alignItems: "center",
    backgroundColor: "#25292A",
    borderRadius: 8,
    bottom: 14,
    flexDirection: "row",
    gap: 7,
    left: 16,
    paddingHorizontal: 9,
    paddingVertical: 8,
    position: "absolute",
  },
  readyText: {
    color: "#F7F9FB",
    fontSize: 12,
    fontWeight: "900",
  },
  resultsCard: {
    backgroundColor: "#151719",
    borderColor: "#2B2E32",
    borderRadius: 41,
    borderWidth: 1,
    marginTop: 12,
    maxWidth: 454,
    padding: 21,
    width: "100%",
  },
  resultsHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 18,
  },
  resultsTitleWrap: {
    alignItems: "center",
    flexDirection: "row",
    gap: 11,
  },
  iconBubbleSmall: {
    alignItems: "center",
    backgroundColor: "#9DC7E5",
    borderRadius: 17,
    height: 34,
    justifyContent: "center",
    width: 34,
  },
  resultsTitle: {
    color: "#F7F9FB",
    fontSize: 18,
    fontWeight: "900",
    letterSpacing: 0,
  },
  newScanText: {
    color: "#9DC7E5",
    fontSize: 14,
    fontWeight: "800",
  },
  dishList: {
    gap: 8,
  },
  dishRow: {
    alignItems: "center",
    backgroundColor: "#1B1E20",
    borderRadius: 23,
    flexDirection: "row",
    height: 43,
    paddingLeft: 17,
    paddingRight: 14,
  },
  dishTag: {
    backgroundColor: "#7791A5",
    borderRadius: 11,
    color: "#11161A",
    fontSize: 10,
    fontWeight: "900",
    marginRight: 13,
    minWidth: 37,
    overflow: "hidden",
    paddingHorizontal: 8,
    paddingVertical: 4,
    textAlign: "center",
  },
  dishName: {
    color: "#F7F9FB",
    flex: 1,
    fontSize: 14,
    fontWeight: "900",
    letterSpacing: 0,
  },
  dishPrice: {
    color: "#F7F9FB",
    fontSize: 14,
    fontWeight: "900",
    marginLeft: 12,
  },
  gambleButton: {
    alignItems: "center",
    backgroundColor: "#9DC7E5",
    borderRadius: 28,
    flexDirection: "row",
    gap: 10,
    height: 56,
    justifyContent: "center",
    marginTop: 17,
  },
  gambleText: {
    color: "#071014",
    fontSize: 16,
    fontWeight: "900",
    letterSpacing: 0,
  },
  tabBar: {
    alignItems: "center",
    alignSelf: "center",
    backgroundColor: "#F0F3F6",
    borderRadius: 31,
    bottom: 8,
    flexDirection: "row",
    height: 61,
    justifyContent: "space-around",
    paddingHorizontal: 40,
    position: "absolute",
    width: 321,
  },
  tabItem: {
    alignItems: "center",
    gap: 4,
    width: 86,
  },
  tabLabelActive: {
    color: "#07090B",
    fontSize: 10,
    fontWeight: "900",
  },
  tabLabel: {
    color: "#41464E",
    fontSize: 10,
    fontWeight: "500",
  },
  sheetBackdrop: {
    flex: 1,
  },
  sheetBlur: {
    ...StyleSheet.absoluteFillObject,
  },
  sheetBlurFill: {
    flex: 1,
  },
  sheetDim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(220, 223, 224, 0.5)",
  },
  sheetDismissLayer: {
    ...StyleSheet.absoluteFillObject,
  },
  sheet: {
    alignSelf: "center",
    backgroundColor: "#17191B",
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28,
    maxWidth: 448,
    paddingBottom: 23,
    paddingHorizontal: 20,
    paddingTop: 16,
    width: "100%",
  },
  sheetHandle: {
    alignSelf: "center",
    backgroundColor: "#34373B",
    borderRadius: 3,
    height: 6,
    marginBottom: 25,
    width: 48,
  },
  sheetHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 20,
  },
  sheetTitle: {
    color: "#F7F9FB",
    fontSize: 17,
    fontWeight: "900",
  },
  sheetClose: {
    alignItems: "center",
    backgroundColor: "#25292E",
    borderRadius: 16,
    height: 32,
    justifyContent: "center",
    width: 32,
  },
  sheetOption: {
    alignItems: "center",
    borderColor: "#2D3137",
    borderRadius: 40,
    borderWidth: 1,
    flexDirection: "row",
    gap: 16,
    height: 78,
    marginBottom: 10,
    paddingHorizontal: 17,
  },
  sheetOptionIconActive: {
    alignItems: "center",
    backgroundColor: "#27323E",
    borderRadius: 22,
    height: 45,
    justifyContent: "center",
    width: 45,
  },
  sheetOptionIcon: {
    alignItems: "center",
    backgroundColor: "#17191B",
    borderColor: "#2D3137",
    borderRadius: 22,
    borderWidth: 1,
    height: 45,
    justifyContent: "center",
    width: 45,
  },
  optionTitle: {
    color: "#F7F9FB",
    fontSize: 15,
    fontWeight: "900",
    lineHeight: 20,
  },
  optionSubtitle: {
    color: "#AEB6C1",
    fontSize: 13,
    fontWeight: "500",
    lineHeight: 18,
  },
  buttonPressed: {
    opacity: 0.72,
    transform: [{ scale: 0.98 }],
  },
  caseOverlay: {
    alignItems: "center",
    backgroundColor: "rgba(7, 9, 11, 0.9)",
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
    color: "#F7F9FB",
    fontSize: 14,
    fontWeight: "900",
    letterSpacing: 0,
    marginBottom: 16,
    textTransform: "uppercase",
  },
  caseWindow: {
    alignItems: "center",
    backgroundColor: "#151719",
    borderColor: "#9DC7E5",
    borderRadius: 10,
    borderWidth: 2,
    height: 190,
    justifyContent: "center",
    overflow: "hidden",
    width: 190,
  },
  caseRoll: {
    left: 12,
    position: "absolute",
    right: 12,
    top: 0,
  },
  caseRollText: {
    color: "#D7E9F7",
    fontSize: 15,
    fontWeight: "900",
    height: 44,
    lineHeight: 44,
    textAlign: "center",
  },
  caseCenterLine: {
    backgroundColor: "rgba(247, 249, 251, 0.14)",
    height: 46,
    left: 8,
    position: "absolute",
    right: 8,
    top: 72,
  },
  caseWinner: {
    alignItems: "center",
    backgroundColor: "#F7F9FB",
    borderColor: "#D7E9F7",
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 108,
    paddingHorizontal: 14,
    position: "absolute",
    width: 150,
  },
  caseWinnerLabel: {
    color: "#638EAD",
    fontSize: 11,
    fontWeight: "900",
    marginBottom: 7,
    textTransform: "uppercase",
  },
  caseWinnerText: {
    color: "#071014",
    fontSize: 21,
    fontWeight: "900",
    lineHeight: 25,
    textAlign: "center",
  },
  caseCloseButton: {
    alignItems: "center",
    backgroundColor: "#F7F9FB",
    borderRadius: 16,
    justifyContent: "center",
    marginTop: 18,
    minHeight: 50,
    paddingHorizontal: 26,
  },
  caseCloseText: {
    color: "#071014",
    fontSize: 14,
    fontWeight: "900",
  },
});
