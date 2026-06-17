import { StatusBar } from 'expo-status-bar';
import { useMemo, useState } from 'react';
import {
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

type DecisionTemplate = {
  title: string;
  context: string;
  impact: string;
  accent: string;
};

const templates: DecisionTemplate[] = [
  {
    title: 'Weekend trip',
    context: 'Compare cost, travel time, weather, and reset value.',
    impact: 'Low risk',
    accent: '#0F9F8F',
  },
  {
    title: 'Team roadmap',
    context: 'Balance user urgency, engineering lift, and strategic upside.',
    impact: 'High leverage',
    accent: '#315CFF',
  },
  {
    title: 'Budget choice',
    context: 'Weigh cash flow, must-haves, tradeoffs, and timing.',
    impact: 'Money call',
    accent: '#D78721',
  },
];

const confidenceLevels = ['Low', 'Medium', 'High'];

export default function App() {
  const [selectedTemplate, setSelectedTemplate] = useState(templates[0]);
  const [confidence, setConfidence] = useState('Medium');
  const [notes, setNotes] = useState('');

  const recommendation = useMemo(() => {
    if (confidence === 'High') {
      return 'Move forward after one final objection check.';
    }

    if (confidence === 'Low') {
      return 'Gather one missing fact before making the call.';
    }

    return 'Choose the option with the clearest next step today.';
  }, [confidence]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="dark" />
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <View>
            <Text style={styles.brand}>Decaide</Text>
            <Text style={styles.headline}>What should we decide?</Text>
          </View>
          <View style={styles.scorePill}>
            <Text style={styles.scoreLabel}>CLARITY</Text>
            <Text style={styles.scoreValue}>78</Text>
          </View>
        </View>

        <View style={styles.promptPanel}>
          <Text style={styles.panelLabel}>Current decision</Text>
          <Text style={styles.panelTitle}>{selectedTemplate.title}</Text>
          <Text style={styles.panelCopy}>{selectedTemplate.context}</Text>
        </View>

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Decision starters</Text>
          <Text style={styles.sectionMeta}>3 templates</Text>
        </View>

        <View style={styles.templateList}>
          {templates.map((template) => {
            const isSelected = template.title === selectedTemplate.title;

            return (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: isSelected }}
                key={template.title}
                onPress={() => setSelectedTemplate(template)}
                style={[
                  styles.templateCard,
                  isSelected && styles.templateCardSelected,
                ]}
              >
                <View
                  style={[
                    styles.accentRail,
                    { backgroundColor: template.accent },
                  ]}
                />
                <View style={styles.templateBody}>
                  <View style={styles.templateTopline}>
                    <Text style={styles.templateTitle}>{template.title}</Text>
                    <Text style={styles.templateImpact}>{template.impact}</Text>
                  </View>
                  <Text style={styles.templateContext}>{template.context}</Text>
                </View>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.controlsPanel}>
          <Text style={styles.sectionTitle}>Confidence</Text>
          <View style={styles.segmentedControl}>
            {confidenceLevels.map((level) => {
              const isSelected = level === confidence;

              return (
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ selected: isSelected }}
                  key={level}
                  onPress={() => setConfidence(level)}
                  style={[
                    styles.segmentButton,
                    isSelected && styles.segmentButtonSelected,
                  ]}
                >
                  <Text
                    style={[
                      styles.segmentText,
                      isSelected && styles.segmentTextSelected,
                    ]}
                  >
                    {level}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <TextInput
            multiline
            onChangeText={setNotes}
            placeholder="Add the tradeoff, constraint, or open question..."
            placeholderTextColor="#8B938E"
            style={styles.input}
            textAlignVertical="top"
            value={notes}
          />
        </View>

        <View style={styles.summaryPanel}>
          <Text style={styles.panelLabel}>Recommended next step</Text>
          <Text style={styles.summaryText}>{recommendation}</Text>
          <Text style={styles.summaryMeta}>
            {notes.trim().length > 0
              ? 'Notes captured for the decision brief.'
              : 'Add context to make the brief more specific.'}
          </Text>
        </View>
      </ScrollView>

      <View style={styles.bottomBar}>
        <Pressable accessibilityRole="button" style={styles.secondaryButton}>
          <Text style={styles.secondaryButtonText}>Save draft</Text>
        </Pressable>
        <Pressable accessibilityRole="button" style={styles.primaryButton}>
          <Text style={styles.primaryButtonText}>Start decision</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#F8FAF8',
  },
  content: {
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 116,
  },
  header: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 16,
  },
  brand: {
    color: '#111614',
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: 0,
  },
  headline: {
    color: '#111614',
    fontSize: 34,
    fontWeight: '800',
    letterSpacing: 0,
    lineHeight: 39,
    marginTop: 12,
    maxWidth: 260,
  },
  scorePill: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderColor: '#DCE5DF',
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  scoreLabel: {
    color: '#69736E',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0,
  },
  scoreValue: {
    color: '#0B7F73',
    fontSize: 24,
    fontWeight: '800',
    letterSpacing: 0,
    marginTop: 2,
  },
  promptPanel: {
    backgroundColor: '#13221E',
    borderRadius: 8,
    marginTop: 28,
    padding: 20,
  },
  panelLabel: {
    color: '#7E8C86',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0,
    textTransform: 'uppercase',
  },
  panelTitle: {
    color: '#FFFFFF',
    fontSize: 25,
    fontWeight: '800',
    letterSpacing: 0,
    lineHeight: 30,
    marginTop: 12,
  },
  panelCopy: {
    color: '#D8E4DF',
    fontSize: 15,
    fontWeight: '500',
    letterSpacing: 0,
    lineHeight: 22,
    marginTop: 8,
  },
  sectionHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 28,
  },
  sectionTitle: {
    color: '#111614',
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: 0,
  },
  sectionMeta: {
    color: '#69736E',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0,
  },
  templateList: {
    gap: 12,
    marginTop: 14,
  },
  templateCard: {
    backgroundColor: '#FFFFFF',
    borderColor: '#DCE5DF',
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    minHeight: 96,
    overflow: 'hidden',
  },
  templateCardSelected: {
    borderColor: '#0F9F8F',
  },
  accentRail: {
    width: 6,
  },
  templateBody: {
    flex: 1,
    padding: 16,
  },
  templateTopline: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'space-between',
  },
  templateTitle: {
    color: '#111614',
    flex: 1,
    fontSize: 17,
    fontWeight: '800',
    letterSpacing: 0,
  },
  templateImpact: {
    color: '#52615A',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0,
  },
  templateContext: {
    color: '#69736E',
    fontSize: 14,
    fontWeight: '500',
    letterSpacing: 0,
    lineHeight: 20,
    marginTop: 8,
  },
  controlsPanel: {
    backgroundColor: '#FFFFFF',
    borderColor: '#DCE5DF',
    borderRadius: 8,
    borderWidth: 1,
    marginTop: 18,
    padding: 16,
  },
  segmentedControl: {
    backgroundColor: '#EEF3F0',
    borderRadius: 8,
    flexDirection: 'row',
    gap: 6,
    marginTop: 14,
    padding: 5,
  },
  segmentButton: {
    alignItems: 'center',
    borderRadius: 6,
    flex: 1,
    minHeight: 42,
    justifyContent: 'center',
  },
  segmentButtonSelected: {
    backgroundColor: '#FFFFFF',
  },
  segmentText: {
    color: '#69736E',
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 0,
  },
  segmentTextSelected: {
    color: '#111614',
  },
  input: {
    backgroundColor: '#F8FAF8',
    borderColor: '#DCE5DF',
    borderRadius: 8,
    borderWidth: 1,
    color: '#111614',
    fontSize: 15,
    fontWeight: '500',
    letterSpacing: 0,
    lineHeight: 22,
    marginTop: 14,
    minHeight: 104,
    padding: 14,
  },
  summaryPanel: {
    backgroundColor: '#FFF7EA',
    borderColor: '#F1D8B5',
    borderRadius: 8,
    borderWidth: 1,
    marginTop: 18,
    padding: 18,
  },
  summaryText: {
    color: '#22170A',
    fontSize: 19,
    fontWeight: '800',
    letterSpacing: 0,
    lineHeight: 25,
    marginTop: 10,
  },
  summaryMeta: {
    color: '#755629',
    fontSize: 14,
    fontWeight: '600',
    letterSpacing: 0,
    lineHeight: 20,
    marginTop: 8,
  },
  bottomBar: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderColor: '#DCE5DF',
    borderTopWidth: 1,
    bottom: 0,
    flexDirection: 'row',
    gap: 12,
    left: 0,
    paddingHorizontal: 20,
    paddingBottom: 22,
    paddingTop: 14,
    position: 'absolute',
    right: 0,
  },
  secondaryButton: {
    alignItems: 'center',
    borderColor: '#DCE5DF',
    borderRadius: 8,
    borderWidth: 1,
    flex: 0.92,
    justifyContent: 'center',
    minHeight: 52,
  },
  secondaryButtonText: {
    color: '#111614',
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 0,
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: '#0F9F8F',
    borderRadius: 8,
    flex: 1.08,
    justifyContent: 'center',
    minHeight: 52,
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 0,
  },
});
