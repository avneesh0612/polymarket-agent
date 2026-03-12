import { useState, useRef, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from "react-native";
import { Audio } from "expo-av";
import * as FileSystem from "expo-file-system";
import { useReactiveClient } from "@dynamic-labs/react-hooks";
import { VoiceButton } from "./VoiceButton";
import { sendMessage, getDelegationStatus } from "../lib/api";
import { dynamicClient } from "../lib/dynamic";

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3001";

const SUGGESTIONS = [
  "Show my wallet balance",
  "Search Polymarket markets",
  "Show my positions",
  "Bet $2 on a market",
];

interface Message {
  id: string;
  role: "user" | "agent";
  content: string;
  timestamp: Date;
  error?: boolean;
}

function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === "user";
  return (
    <View style={[styles.bubbleRow, isUser ? styles.bubbleRowUser : styles.bubbleRowAgent]}>
      <View
        style={[
          styles.bubble,
          isUser ? styles.bubbleUser : styles.bubbleAgent,
          message.error && styles.bubbleError,
        ]}
      >
        <Text style={[styles.bubbleText, isUser ? styles.bubbleTextUser : styles.bubbleTextAgent]}>
          {message.content}
        </Text>
        <Text style={[styles.timestamp, isUser ? styles.timestampUser : styles.timestampAgent]}>
          {message.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </Text>
      </View>
    </View>
  );
}

function ThinkingBubble() {
  return (
    <View style={[styles.bubbleRow, styles.bubbleRowAgent]}>
      <View style={[styles.bubble, styles.bubbleAgent]}>
        <View style={styles.thinkingDots}>
          {[0, 1, 2].map((i) => (
            <View key={i} style={styles.dot} />
          ))}
        </View>
      </View>
    </View>
  );
}

export function ChatInterface() {
  // Dynamic auth — token is null when logged out, JWT string when logged in
  const { auth, wallets } = useReactiveClient(dynamicClient);
  const authToken = auth.token;

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isDelegated, setIsDelegated] = useState<boolean | null>(null);
  const [voiceOutput, setVoiceOutput] = useState(false);
  const flatListRef = useRef<FlatList>(null);
  const soundRef = useRef<Audio.Sound | null>(null);

  // Check delegation status whenever auth changes
  useEffect(() => {
    if (!authToken) {
      setIsDelegated(null);
      return;
    }
    getDelegationStatus(authToken)
      .then((s) => setIsDelegated(s.delegated))
      .catch(() => setIsDelegated(false));
  }, [authToken]);

  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }, [messages, isLoading]);

  // TTS: fetch MP3 from backend, save to cache dir, play with expo-av
  const speak = async (text: string) => {
    if (!authToken) return;
    try {
      if (soundRef.current) {
        await soundRef.current.unloadAsync();
        soundRef.current = null;
      }

      const res = await fetch(`${API_URL}/api/voice/tts`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) return;

      // Download audio to a temp file so expo-av can play it
      const audioUri = `${FileSystem.cacheDirectory}tts-${Date.now()}.mp3`;
      const base64 = await res
        .arrayBuffer()
        .then((buf) =>
          btoa(String.fromCharCode(...new Uint8Array(buf)))
        );
      await FileSystem.writeAsStringAsync(audioUri, base64, {
        encoding: FileSystem.EncodingType.Base64,
      });

      await Audio.setAudioModeAsync({ playsInSilentModeIOS: true });
      const { sound } = await Audio.Sound.createAsync({ uri: audioUri });
      soundRef.current = sound;
      await sound.playAsync();

      sound.setOnPlaybackStatusUpdate((status) => {
        if (status.isLoaded && status.didJustFinish) {
          sound.unloadAsync();
          soundRef.current = null;
          FileSystem.deleteAsync(audioUri, { idempotent: true });
        }
      });
    } catch (err) {
      console.warn("[tts] playback error:", err);
    }
  };

  // Prompt delegation if the user is authenticated but hasn't delegated yet
  const promptDelegation = async () => {
    try {
      const shouldPrompt =
        await dynamicClient.wallets.delegation.shouldPromptWalletDelegation();
      if (shouldPrompt) {
        await dynamicClient.wallets.delegation.initDelegationProcess();
      }
    } catch (err) {
      console.warn("[delegation] prompt error:", err);
    }
  };

  const handleSend = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || isLoading) return;

    // Prompt login if not authenticated
    if (!authToken) {
      dynamicClient.ui.auth.show();
      return;
    }

    // Prompt delegation if not yet delegated
    if (isDelegated === false) {
      await promptDelegation();
      return;
    }

    const userMsg: Message = {
      id: Date.now().toString(),
      role: "user",
      content: trimmed,
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setIsLoading(true);

    try {
      const response = await sendMessage(trimmed, authToken);
      const agentMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: "agent",
        content: response,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, agentMsg]);
      if (voiceOutput) speak(response);
    } catch (err) {
      const errMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: "agent",
        content: err instanceof Error ? err.message : "Something went wrong.",
        timestamp: new Date(),
        error: true,
      };
      setMessages((prev) => [...prev, errMsg]);
    } finally {
      setIsLoading(false);
    }
  };

  const isEmpty = messages.length === 0 && !isLoading;

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={Platform.OS === "ios" ? 90 : 0}
    >
      {/* Messages */}
      <FlatList
        ref={flatListRef}
        style={styles.messageList}
        contentContainerStyle={styles.messageContent}
        data={messages}
        keyExtractor={(m) => m.id}
        renderItem={({ item }) => <MessageBubble message={item} />}
        ListEmptyComponent={
          isEmpty ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyTitle}>Web3 AI Agent</Text>
              <Text style={styles.emptySubtitle}>
                Ask me to check balances, search Polymarket, or place bets.
              </Text>
              <View style={styles.suggestions}>
                {SUGGESTIONS.map((s) => (
                  <TouchableOpacity key={s} style={styles.suggestion} onPress={() => handleSend(s)}>
                    <Text style={styles.suggestionText}>{s}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          ) : null
        }
        ListFooterComponent={isLoading ? <ThinkingBubble /> : null}
      />

      {/* Not-logged-in banner */}
      {!authToken && (
        <TouchableOpacity
          style={styles.authBanner}
          onPress={() => dynamicClient.ui.auth.show()}
        >
          <Text style={styles.authBannerText}>
            Tap to connect your wallet and get started
          </Text>
        </TouchableOpacity>
      )}

      {/* Delegation banner */}
      {authToken && isDelegated === false && (
        <TouchableOpacity
          style={styles.delegationBanner}
          onPress={promptDelegation}
        >
          <Text style={styles.authBannerText}>
            Delegate wallet access so the agent can trade on your behalf →
          </Text>
        </TouchableOpacity>
      )}

      {/* Input bar */}
      <View style={styles.inputBar}>
        {/* Voice output toggle */}
        <TouchableOpacity
          style={[styles.voiceToggle, voiceOutput && styles.voiceToggleActive]}
          onPress={() => setVoiceOutput((v) => !v)}
          accessibilityLabel="Toggle voice output"
        >
          <Text style={styles.voiceToggleText}>{voiceOutput ? "🔊" : "🔇"}</Text>
        </TouchableOpacity>

        <TextInput
          style={styles.input}
          value={input}
          onChangeText={setInput}
          placeholder={authToken ? "Ask me anything..." : "Connect wallet to start"}
          placeholderTextColor="#9ca3af"
          multiline
          maxLength={2000}
          editable={!isLoading && !!authToken}
        />
        <View style={styles.inputActions}>
          {authToken && (
            <VoiceButton
              authToken={authToken}
              apiUrl={API_URL}
              onTranscription={(text) => handleSend(text)}
              onError={(e) => console.warn("Voice error:", e)}
              disabled={isLoading}
            />
          )}
          <TouchableOpacity
            style={[
              styles.sendButton,
              (!input.trim() || isLoading || !authToken) && styles.sendDisabled,
            ]}
            onPress={() => (authToken ? handleSend(input) : dynamicClient.ui.auth.show())}
            disabled={isLoading}
          >
            {isLoading ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={styles.sendText}>↑</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f9fafb" },
  messageList: { flex: 1 },
  messageContent: { padding: 16, paddingBottom: 8 },
  bubbleRow: { flexDirection: "row", marginBottom: 12 },
  bubbleRowUser: { justifyContent: "flex-end" },
  bubbleRowAgent: { justifyContent: "flex-start" },
  bubble: { maxWidth: "80%", borderRadius: 18, paddingHorizontal: 14, paddingVertical: 10 },
  bubbleUser: { backgroundColor: "#7c3aed", borderBottomRightRadius: 4 },
  bubbleAgent: { backgroundColor: "#fff", borderWidth: 1, borderColor: "#e5e7eb", borderBottomLeftRadius: 4 },
  bubbleError: { backgroundColor: "#fef2f2", borderColor: "#fca5a5" },
  bubbleText: { fontSize: 15, lineHeight: 22 },
  bubbleTextUser: { color: "#fff" },
  bubbleTextAgent: { color: "#111827" },
  timestamp: { fontSize: 10, marginTop: 4 },
  timestampUser: { color: "#c4b5fd" },
  timestampAgent: { color: "#9ca3af" },
  thinkingDots: { flexDirection: "row", gap: 4, paddingVertical: 4 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#9ca3af" },
  emptyState: { alignItems: "center", paddingTop: 60, paddingHorizontal: 24 },
  emptyTitle: { fontSize: 20, fontWeight: "700", color: "#111827", marginBottom: 8 },
  emptySubtitle: { fontSize: 14, color: "#6b7280", textAlign: "center", lineHeight: 20, marginBottom: 24 },
  suggestions: { width: "100%", gap: 8 },
  suggestion: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  suggestionText: { fontSize: 14, color: "#374151" },
  inputBar: {
    flexDirection: "row",
    alignItems: "flex-end",
    padding: 12,
    backgroundColor: "#fff",
    borderTopWidth: 1,
    borderTopColor: "#e5e7eb",
    gap: 8,
  },
  input: {
    flex: 1,
    backgroundColor: "#f3f4f6",
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 15,
    color: "#111827",
    maxHeight: 120,
  },
  inputActions: { flexDirection: "row", alignItems: "center", gap: 8, paddingBottom: 2 },
  sendButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#7c3aed",
    alignItems: "center",
    justifyContent: "center",
  },
  sendDisabled: { opacity: 0.4 },
  sendText: { color: "#fff", fontSize: 18, fontWeight: "bold" },
  authBanner: {
    backgroundColor: "#7c3aed",
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  delegationBanner: {
    backgroundColor: "#f59e0b",
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  authBannerText: { color: "#fff", fontSize: 13, textAlign: "center", fontWeight: "500" },
  voiceToggle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#f3f4f6",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 2,
  },
  voiceToggleActive: { backgroundColor: "#ede9fe" },
  voiceToggleText: { fontSize: 16 },
});
