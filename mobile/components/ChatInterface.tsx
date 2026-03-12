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
  Animated,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Audio } from "expo-av";
import * as FileSystem from "expo-file-system";
import { VoiceButton } from "./VoiceButton";
import { sendMessage, getDelegationStatus, getChatHistory } from "../lib/api";
import { dynamicClient } from "../lib/dynamic";
import { useReactiveClient } from "@dynamic-labs/react-hooks";

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3001";

// ─── Design tokens (iMessage-style) ──────────────────────────────────────────

const C = {
  blue: "#1a73e8",        // iMessage blue (slightly richer than default)
  blueDark: "#0060d0",
  bg: "#ffffff",
  listBg: "#f2f2f7",      // iOS system gray 6
  userBubble: "#1a73e8",
  agentBubble: "#e9e9eb", // iMessage gray
  border: "#d1d1d6",
  text: "#000000",
  textSecondary: "#3c3c43",
  muted: "#8e8e93",
  surface: "#ffffff",
  amber: "#f59e0b",
  green: "#34c759",       // iOS green
  red: "#ff3b30",         // iOS red
  errorBg: "#fff0f0",
};

// ─── Types ────────────────────────────────────────────────────────────────────

interface Message {
  id: string;
  role: "user" | "agent";
  content: string;
  timestamp: Date;
  error?: boolean;
}

const SUGGESTIONS: { label: string; icon: string }[] = [
  { label: "Show my wallet balance", icon: "wallet-outline" },
  { label: "Search Polymarket markets", icon: "search-outline" },
  { label: "Show my positions", icon: "bar-chart-outline" },
  { label: "Bet $2 on a market", icon: "trending-up-outline" },
];

// ─── Message bubble ───────────────────────────────────────────────────────────

function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === "user";
  const time = message.timestamp.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });

  return (
    <View style={[styles.msgRow, isUser ? styles.msgRowUser : styles.msgRowAgent]}>
      <View style={styles.msgContent}>
        <View
          style={[
            styles.bubble,
            isUser ? styles.bubbleUser : styles.bubbleAgent,
            message.error && styles.bubbleError,
          ]}
        >
          <Text
            style={[
              styles.bubbleText,
              isUser ? styles.bubbleTextUser : styles.bubbleTextAgent,
              message.error && styles.bubbleTextError,
            ]}
          >
            {message.content}
          </Text>
        </View>
        <Text style={[styles.timeLabel, isUser ? styles.timeLabelUser : styles.timeLabelAgent]}>
          {time}
        </Text>
      </View>
    </View>
  );
}

// ─── Animated thinking indicator ──────────────────────────────────────────────

function ThinkingBubble() {
  const [secs, setSecs] = useState(0);
  const dots = [
    useRef(new Animated.Value(0)).current,
    useRef(new Animated.Value(0)).current,
    useRef(new Animated.Value(0)).current,
  ];

  useEffect(() => {
    const timer = setInterval(() => setSecs((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const anims = dots.map((dot, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 160),
          Animated.timing(dot, { toValue: 1, duration: 260, useNativeDriver: true }),
          Animated.timing(dot, { toValue: 0, duration: 260, useNativeDriver: true }),
          Animated.delay((2 - i) * 160),
        ])
      )
    );
    anims.forEach((a) => a.start());
    return () => anims.forEach((a) => a.stop());
  }, []);

  const longWait = secs >= 8;

  return (
    <View style={[styles.msgRow, styles.msgRowAgent]}>
      <View style={styles.msgContent}>
        <View style={[styles.bubble, styles.bubbleAgent, styles.thinkingBubble]}>
          <View style={styles.dotsRow}>
            {dots.map((dot, i) => (
              <Animated.View
                key={i}
                style={[
                  styles.dot,
                  {
                    opacity: dot.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] }),
                    transform: [
                      {
                        translateY: dot.interpolate({
                          inputRange: [0, 1],
                          outputRange: [0, -4],
                        }),
                      },
                    ],
                  },
                ]}
              />
            ))}
            {longWait && (
              <Text style={styles.thinkingTime}>{secs}s</Text>
            )}
          </View>
        </View>
      </View>
    </View>
  );
}

// ─── Empty / welcome state ────────────────────────────────────────────────────

function EmptyState({ onSuggestion }: { onSuggestion: (text: string) => void }) {
  return (
    <View style={styles.emptyWrap}>
      <View style={styles.emptyIconRing}>
        <Ionicons name="sparkles" size={26} color={C.blue} />
      </View>
      <Text style={styles.emptyTitle}>Web3 AI Agent</Text>
      <Text style={styles.emptySubtitle}>
        Ask me anything about your wallet, Polymarket markets, or DeFi.
      </Text>
      <View style={styles.suggestionsGrid}>
        {SUGGESTIONS.map((s) => (
          <TouchableOpacity
            key={s.label}
            style={styles.suggestionCard}
            onPress={() => onSuggestion(s.label)}
            activeOpacity={0.7}
          >
            <View style={styles.suggestionIcon}>
              <Ionicons name={s.icon as any} size={16} color={C.blue} />
            </View>
            <Text style={styles.suggestionText}>{s.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

// ─── Status banner ────────────────────────────────────────────────────────────

interface StatusBannerProps {
  authToken: string | null | undefined;
  isDelegated: boolean | null;
  onAuthPress: () => void;
  onDelegatePress: () => void;
  onRevokePress: () => void;
}

function StatusBanner({
  authToken,
  isDelegated,
  onAuthPress,
  onDelegatePress,
  onRevokePress,
}: StatusBannerProps) {
  if (!authToken) {
    return (
      <TouchableOpacity style={[styles.banner, { backgroundColor: C.blue }]} onPress={onAuthPress} activeOpacity={0.85}>
        <Ionicons name="wallet-outline" size={15} color="#fff" style={styles.bannerIcon} />
        <Text style={styles.bannerText}>Connect wallet to start chatting</Text>
        <Ionicons name="chevron-forward" size={14} color="rgba(255,255,255,0.7)" />
      </TouchableOpacity>
    );
  }
  if (isDelegated === false) {
    return (
      <TouchableOpacity style={[styles.banner, { backgroundColor: C.amber }]} onPress={onDelegatePress} activeOpacity={0.85}>
        <Ionicons name="link-outline" size={15} color="#fff" style={styles.bannerIcon} />
        <Text style={styles.bannerText}>Grant wallet access for trading</Text>
        <Ionicons name="chevron-forward" size={14} color="rgba(255,255,255,0.7)" />
      </TouchableOpacity>
    );
  }
  if (isDelegated === true) {
    return (
      <TouchableOpacity style={[styles.banner, { backgroundColor: C.green }]} onPress={onRevokePress} activeOpacity={0.85}>
        <View style={styles.activeDot} />
        <Text style={styles.bannerText}>Agent active · Tap to revoke</Text>
        <Ionicons name="chevron-forward" size={14} color="rgba(255,255,255,0.7)" />
      </TouchableOpacity>
    );
  }
  return null;
}

// ─── Main component ───────────────────────────────────────────────────────────

export function ChatInterface() {
  const { auth } = useReactiveClient(dynamicClient);
  const authToken = auth.token;

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isDelegated, setIsDelegated] = useState<boolean | null>(null);
  const [voiceOutput, setVoiceOutput] = useState(false);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const flatListRef = useRef<FlatList>(null);
  const soundRef = useRef<Audio.Sound | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Load delegation status + chat history on auth change
  useEffect(() => {
    if (!authToken) {
      setIsDelegated(null);
      setMessages([]);
      setHistoryLoaded(false);
      return;
    }

    getDelegationStatus(authToken)
      .then((s) => setIsDelegated(s.delegated))
      .catch(() => setIsDelegated(false));

    if (!historyLoaded) {
      getChatHistory(authToken)
        .then((history) => {
          if (history.length > 0) {
            setMessages(
              history.map((m, i) => ({
                id: `history-${i}`,
                role: m.role === "user" ? "user" : "agent",
                content: m.content,
                timestamp: new Date(m.created_at),
              }))
            );
          }
          setHistoryLoaded(true);
        })
        .catch(() => setHistoryLoaded(true));
    }
  }, [authToken]);

  // Scroll to end on new messages
  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }, [messages, isLoading]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      soundRef.current?.unloadAsync().catch(() => {});
    };
  }, []);

  // TTS
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

      const audioUri = `${FileSystem.cacheDirectory}tts-${Date.now()}.mp3`;
      const base64 = await res
        .arrayBuffer()
        .then((buf) => btoa(String.fromCharCode(...new Uint8Array(buf))));
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

  const handleCancel = () => {
    abortRef.current?.abort();
  };

  const promptDelegation = async () => {
    try {
      const shouldPrompt =
        await dynamicClient.wallets.waas.delegation.shouldPromptWalletDelegation();
      if (shouldPrompt) {
        await dynamicClient.wallets.waas.delegation.initDelegationProcess({});
      }
    } catch (err) {
      console.warn("[delegation] prompt error:", err);
    }
  };

  const revokeDelegation = async () => {
    try {
      const walletsStatus =
        await dynamicClient.wallets.waas.delegation.getWalletsDelegatedStatus();
      const delegatedWallets = walletsStatus
        .filter((w: { isDelegated: boolean }) => w.isDelegated)
        .map((w: { chainName: string; accountAddress: string }) => ({
          chainName: w.chainName,
          accountAddress: w.accountAddress,
        }));
      if (delegatedWallets.length === 0) return;
      await dynamicClient.wallets.waas.delegation.revokeDelegation({
        wallets: delegatedWallets,
      });
      setIsDelegated(false);
    } catch (err) {
      console.warn("[delegation] revoke error:", err);
    }
  };

  const handleSend = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || isLoading) return;

    if (!authToken) {
      dynamicClient.ui.auth.show();
      return;
    }
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

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await sendMessage(trimmed, authToken, controller.signal);
      const agentMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: "agent",
        content: response,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, agentMsg]);
      if (voiceOutput) {
        speak(response).catch(() => {});
      }
    } catch (err) {
      if (err instanceof Error && err.message === "Request cancelled.") return;
      setMessages((prev) => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          role: "agent",
          content: err instanceof Error ? err.message : "Something went wrong.",
          timestamp: new Date(),
          error: true,
        },
      ]);
    } finally {
      abortRef.current = null;
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
      {/* Status banner */}
      <StatusBanner
        authToken={authToken}
        isDelegated={isDelegated}
        onAuthPress={() => dynamicClient.ui.auth.show()}
        onDelegatePress={promptDelegation}
        onRevokePress={revokeDelegation}
      />

      {/* Message list */}
      <FlatList
        ref={flatListRef}
        style={styles.list}
        contentContainerStyle={[styles.listContent, isEmpty && styles.listContentEmpty]}
        data={messages}
        keyExtractor={(m) => m.id}
        renderItem={({ item }) => <MessageBubble message={item} />}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        ListEmptyComponent={
          isEmpty ? <EmptyState onSuggestion={(s) => handleSend(s)} /> : null
        }
        ListFooterComponent={isLoading ? <ThinkingBubble /> : null}
      />

      {/* Input bar */}
      <View style={styles.inputBar}>
        <View style={styles.inputRow}>
          {/* Voice output toggle */}
          <TouchableOpacity
            style={styles.iconBtn}
            onPress={() => setVoiceOutput((v) => !v)}
            accessibilityLabel="Toggle voice output"
          >
            <Ionicons
              name={voiceOutput ? "volume-high-outline" : "volume-mute-outline"}
              size={22}
              color={voiceOutput ? C.blue : C.muted}
            />
          </TouchableOpacity>

          <TextInput
            style={styles.input}
            value={input}
            onChangeText={setInput}
            placeholder={authToken ? "iMessage" : "Connect wallet to start"}
            placeholderTextColor={C.muted}
            multiline
            maxLength={2000}
            editable={!isLoading && !!authToken}
          />

          <View style={styles.inputActions}>
            {/* Voice input */}
            {authToken && !isLoading && (
              <VoiceButton
                authToken={authToken}
                apiUrl={API_URL}
                onTranscription={(text) => handleSend(text)}
                onError={(e) => console.warn("Voice error:", e)}
                disabled={isLoading}
              />
            )}

            {/* Cancel while loading */}
            {isLoading && (
              <TouchableOpacity style={styles.cancelBtn} onPress={handleCancel} activeOpacity={0.7}>
                <View style={styles.cancelInner}>
                  <Ionicons name="stop" size={14} color="#fff" />
                </View>
              </TouchableOpacity>
            )}

            {/* Send */}
            {!isLoading && (
              <TouchableOpacity
                style={[
                  styles.sendBtn,
                  (!input.trim() || !authToken) && styles.sendBtnDisabled,
                ]}
                onPress={() => (authToken ? handleSend(input) : dynamicClient.ui.auth.show())}
                activeOpacity={0.8}
              >
                <Ionicons name="arrow-up" size={17} color="#fff" />
              </TouchableOpacity>
            )}
          </View>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: C.listBg,
  },

  // Banner
  banner: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 9,
    gap: 8,
  },
  bannerIcon: { marginRight: 2 },
  bannerText: {
    flex: 1,
    color: "#fff",
    fontSize: 13,
    fontWeight: "500",
  },
  activeDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: "#a7f3d0",
    marginRight: 2,
  },

  // List
  list: { flex: 1 },
  listContent: { paddingHorizontal: 12, paddingVertical: 8, paddingBottom: 4 },
  listContentEmpty: { flex: 1 },

  // Message rows
  msgRow: {
    flexDirection: "row",
    marginBottom: 2,
    alignItems: "flex-end",
  },
  msgRowUser: { justifyContent: "flex-end" },
  msgRowAgent: { justifyContent: "flex-start" },
  msgContent: { maxWidth: "75%" },

  // Bubbles — iMessage geometry
  bubble: {
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  bubbleUser: {
    backgroundColor: C.userBubble,
    borderBottomRightRadius: 4,
  },
  bubbleAgent: {
    backgroundColor: C.agentBubble,
    borderBottomLeftRadius: 4,
  },
  bubbleError: {
    backgroundColor: C.errorBg,
  },
  bubbleText: { fontSize: 16, lineHeight: 22 },
  bubbleTextUser: { color: "#fff" },
  bubbleTextAgent: { color: C.text },
  bubbleTextError: { color: C.red },

  // Timestamps
  timeLabel: { fontSize: 11, color: C.muted, marginTop: 3, marginBottom: 6 },
  timeLabelUser: { textAlign: "right", marginRight: 4 },
  timeLabelAgent: { textAlign: "left", marginLeft: 4 },

  // Thinking
  thinkingBubble: { paddingVertical: 11 },
  dotsRow: { flexDirection: "row", gap: 5, alignItems: "center" },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: C.muted,
  },
  thinkingTime: {
    fontSize: 11,
    color: C.muted,
    marginLeft: 6,
  },

  // Empty state
  emptyWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 28,
    paddingBottom: 40,
  },
  emptyIconRing: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: "#e8f0fe",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: C.text,
    marginBottom: 6,
  },
  emptySubtitle: {
    fontSize: 14,
    color: C.muted,
    textAlign: "center",
    lineHeight: 20,
    marginBottom: 28,
  },
  suggestionsGrid: {
    width: "100%",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  suggestionCard: {
    width: "47%",
    backgroundColor: C.surface,
    borderRadius: 14,
    padding: 14,
    gap: 8,
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  suggestionIcon: {
    width: 30,
    height: 30,
    borderRadius: 8,
    backgroundColor: "#e8f0fe",
    alignItems: "center",
    justifyContent: "center",
  },
  suggestionText: {
    fontSize: 13,
    color: C.text,
    fontWeight: "500",
    lineHeight: 18,
  },

  // Input bar — iMessage style
  inputBar: {
    backgroundColor: C.bg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: C.border,
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 6,
  },
  input: {
    flex: 1,
    backgroundColor: C.surface,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.border,
    paddingHorizontal: 14,
    paddingVertical: 9,
    fontSize: 16,
    color: C.text,
    maxHeight: 120,
    lineHeight: 20,
  },
  inputActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingBottom: 1,
  },
  iconBtn: {
    width: 34,
    height: 34,
    alignItems: "center",
    justifyContent: "center",
    paddingBottom: 1,
  },
  sendBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: C.blue,
    alignItems: "center",
    justifyContent: "center",
  },
  sendBtnDisabled: { opacity: 0.3 },
  cancelBtn: {
    width: 34,
    height: 34,
    alignItems: "center",
    justifyContent: "center",
  },
  cancelInner: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: C.muted,
    alignItems: "center",
    justifyContent: "center",
  },
});
