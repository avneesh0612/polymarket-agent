import { useState, useRef } from "react";
import { TouchableOpacity, StyleSheet, Animated, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Audio } from "expo-av";

interface VoiceButtonProps {
  onTranscription: (text: string) => void;
  onError: (error: string) => void;
  authToken: string;
  apiUrl: string;
  disabled?: boolean;
}

type RecordingState = "idle" | "recording" | "processing";

export function VoiceButton({ onTranscription, onError, authToken, apiUrl, disabled }: VoiceButtonProps) {
  const [state, setState] = useState<RecordingState>("idle");
  const recordingRef = useRef<Audio.Recording | null>(null);
  const pulseAnim = useRef(new Animated.Value(1)).current;

  const startPulse = () => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.2, duration: 600, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
      ])
    ).start();
  };

  const stopPulse = () => {
    pulseAnim.stopAnimation();
    pulseAnim.setValue(1);
  };

  const startRecording = async () => {
    try {
      await Audio.requestPermissionsAsync();
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      const { recording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      );
      recordingRef.current = recording;
      setState("recording");
      startPulse();
    } catch (err) {
      onError("Failed to start recording");
    }
  };

  const stopRecording = async () => {
    if (!recordingRef.current) return;
    stopPulse();
    setState("processing");
    try {
      await recordingRef.current.stopAndUnloadAsync();
      const uri = recordingRef.current.getURI();
      recordingRef.current = null;

      if (!uri) throw new Error("No recording URI");

      const formData = new FormData();
      formData.append("audio", { uri, name: "recording.m4a", type: "audio/m4a" } as any);

      const res = await fetch(`${apiUrl}/api/voice/stt`, {
        method: "POST",
        headers: { Authorization: `Bearer ${authToken}` },
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Transcription failed");
      onTranscription(data.text);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Voice error");
    } finally {
      setState("idle");
    }
  };

  const handlePress = () => {
    if (state === "idle") startRecording();
    else if (state === "recording") stopRecording();
  };

  const isRecording = state === "recording";
  const isProcessing = state === "processing";

  return (
    <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
      <TouchableOpacity
        style={[styles.button, isRecording && styles.recording, (disabled || isProcessing) && styles.disabled]}
        onPress={handlePress}
        disabled={disabled || isProcessing}
        activeOpacity={0.7}
      >
        {isProcessing ? (
          <ActivityIndicator size="small" color="#fff" />
        ) : (
          <Ionicons name={isRecording ? "stop" : "mic"} size={20} color="#fff" />
        )}
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  button: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#7c3aed",
    alignItems: "center",
    justifyContent: "center",
  },
  recording: { backgroundColor: "#dc2626" },
  disabled: { opacity: 0.4 },
});
