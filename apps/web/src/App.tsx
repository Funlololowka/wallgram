import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import type { Socket } from "socket.io-client";
import { PixelIcon } from "./components/PixelIcon";
import { api, clearStoredToken, getStoredToken, setStoredToken } from "./lib/api";
import { createSocket } from "./lib/socket";
import type { ChatPreview, Message, User } from "./types";

const REACTIONS = ["\u{1F44D}", "\u2764\uFE0F", "\u{1F525}", "\u{1F602}", "\u{1F62E}", "\u{1F44F}"];
const THEME_KEY = "wallgram.theme-mode";
const UI_LANG_KEY = "wallgram.ui-language";
const MOBILE_QUERY = "(max-width: 980px)";

type ThemeMode = "system" | "light" | "dark";
type UiLanguage = "ru" | "en";
type CreateChatKind = "GROUP" | "CHANNEL";
type RecordingMode = "VOICE" | "VIDEO";
type ChatFilter = "CHATS" | "CHANNELS" | "GROUPS" | "FAVORITES";

interface PendingMedia {
  mediaType: Message["mediaType"];
  mediaUrl: string;
  mediaMeta: Record<string, unknown>;
  name: string;
}

function getInitialThemeMode(): ThemeMode {
  const stored = localStorage.getItem(THEME_KEY);
  return stored === "light" || stored === "dark" || stored === "system" ? stored : "system";
}

function getInitialUiLanguage(): UiLanguage {
  const stored = localStorage.getItem(UI_LANG_KEY);
  if (stored === "ru" || stored === "en") {
    return stored;
  }
  return navigator.language.toLowerCase().startsWith("ru") ? "ru" : "en";
}

function getSystemPrefersDark() {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function sortChats(chats: ChatPreview[]) {
  return [...chats].sort((a, b) => new Date(b.updatedAt).valueOf() - new Date(a.updatedAt).valueOf());
}

function upsertChat(chats: ChatPreview[], candidate: ChatPreview): ChatPreview[] {
  const index = chats.findIndex((chat) => chat.id === candidate.id);
  const next = [...chats];
  if (index >= 0) {
    next[index] = candidate;
  } else {
    next.push(candidate);
  }
  return sortChats(next);
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatLastMessage(chat: ChatPreview, language: UiLanguage) {
  if (!chat.lastMessage) return language === "ru" ? "Нет сообщений" : "No messages";
  if (chat.lastMessage.isDeleted) return language === "ru" ? "Нет сообщений" : "No messages";
  return chat.lastMessage.text ?? (language === "ru" ? "Медиа" : "Media");
}

function chatKindLabel(chat: ChatPreview, language: UiLanguage) {
  if (chat.isFavorites) return language === "ru" ? "Избранное" : "Favorites";
  if (chat.kind === "GROUP") return language === "ru" ? "Группа" : "Group";
  if (chat.kind === "CHANNEL") return language === "ru" ? "Канал" : "Channel";
  return language === "ru" ? "Личные" : "Direct";
}

function chatDisplayTitle(chat: ChatPreview, language: UiLanguage) {
  if (chat.isFavorites) {
    return language === "ru" ? "Избранное" : "Favorites";
  }
  return chat.title;
}

function chatKindIcon(chat: ChatPreview) {
  if (chat.isFavorites) return "star" as const;
  if (chat.kind === "GROUP") return "group" as const;
  if (chat.kind === "CHANNEL") return "channel" as const;
  return "direct" as const;
}

function summarizeReactions(reactions: Message["reactions"]) {
  const map = new Map<string, number>();
  for (const reaction of reactions) {
    map.set(reaction.emoji, (map.get(reaction.emoji) ?? 0) + 1);
  }
  return Array.from(map.entries());
}

function formatDuration(total: number) {
  const min = Math.floor(total / 60)
    .toString()
    .padStart(2, "0");
  const sec = Math.floor(total % 60)
    .toString()
    .padStart(2, "0");
  return `${min}:${sec}`;
}

function toDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

function fileToMediaType(file: File): Message["mediaType"] {
  if (file.type.startsWith("image/")) return "IMAGE";
  if (file.type.startsWith("video/")) return "VIDEO";
  if (file.type.startsWith("audio/")) return "AUDIO";
  return "FILE";
}

function renderMedia(message: Message, language: UiLanguage) {
  if (!message.mediaUrl) return null;
  if (message.mediaType === "IMAGE") {
    return <img className="media-preview image" src={message.mediaUrl} alt="attachment" />;
  }
  if (message.mediaType === "VIDEO") {
    return <video className="media-preview video" src={message.mediaUrl} controls playsInline />;
  }
  if (message.mediaType === "VOICE") {
    const durationRaw = message.mediaMeta?.durationSeconds;
    const duration = typeof durationRaw === "number" ? durationRaw : null;
    return (
      <div className="voice-media">
        <div className="voice-media-head">
          <PixelIcon name="mic" />
          <span>{language === "ru" ? "Голосовое сообщение" : "Voice message"}</span>
          {duration !== null ? <time>{formatDuration(duration)}</time> : null}
        </div>
        <audio className="media-preview audio" src={message.mediaUrl} controls />
      </div>
    );
  }
  if (message.mediaType === "AUDIO") {
    return <audio className="media-preview audio" src={message.mediaUrl} controls />;
  }
  return (
    <a className="media-file" href={message.mediaUrl} target="_blank" rel="noreferrer">
      {language === "ru" ? "Открыть файл" : "Open file"}
    </a>
  );
}

export function App() {
  const [token, setToken] = useState<string | null>(() => getStoredToken());
  const [me, setMe] = useState<User | null>(null);
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [chats, setChats] = useState<ChatPreview[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [messagesByChat, setMessagesByChat] = useState<Record<string, Message[]>>({});
  const [messageText, setMessageText] = useState("");
  const [usersQuery, setUsersQuery] = useState("");
  const [userResults, setUserResults] = useState<User[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [openMessageMenuId, setOpenMessageMenuId] = useState<string | null>(null);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsUsername, setSettingsUsername] = useState("");
  const [settingsDisplayName, setSettingsDisplayName] = useState("");
  const [settingsBio, setSettingsBio] = useState("");
  const [settingsAvatarUrl, setSettingsAvatarUrl] = useState("");

  const [createChatKind, setCreateChatKind] = useState<CreateChatKind | null>(null);
  const [openCreateMenu, setOpenCreateMenu] = useState(false);
  const [chatFilter, setChatFilter] = useState<ChatFilter>("CHATS");
  const [newChatTitle, setNewChatTitle] = useState("");
  const [newChatDescription, setNewChatDescription] = useState("");
  const [forwardMessageId, setForwardMessageId] = useState<string | null>(null);

  const [pendingMedia, setPendingMedia] = useState<PendingMedia | null>(null);
  const [recordingMode, setRecordingMode] = useState<RecordingMode | null>(null);
  const [recordingSeconds, setRecordingSeconds] = useState(0);

  const [uiLanguage, setUiLanguage] = useState<UiLanguage>(() => getInitialUiLanguage());
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => getInitialThemeMode());
  const [systemPrefersDark, setSystemPrefersDark] = useState(() => getSystemPrefersDark());
  const [isMobile, setIsMobile] = useState(() => window.matchMedia(MOBILE_QUERY).matches);
  const [mobilePanel, setMobilePanel] = useState<"menu" | "chat">("menu");

  const socketRef = useRef<Socket | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const avatarFileInputRef = useRef<HTMLInputElement | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recorderChunksRef = useRef<Blob[]>([]);
  const recorderStreamRef = useRef<MediaStream | null>(null);
  const recorderTimerRef = useRef<number | null>(null);
  const recordingSecondsRef = useRef(0);
  const messagesViewportRef = useRef<HTMLDivElement | null>(null);
  const stickToBottomRef = useRef(true);

  const activeChat = useMemo(() => chats.find((chat) => chat.id === activeChatId) ?? null, [chats, activeChatId]);
  const activeMessages = activeChatId ? messagesByChat[activeChatId] ?? [] : [];
  const tr = (en: string, ru: string) => (uiLanguage === "ru" ? ru : en);
  const layoutClassName = isMobile ? `layout ${mobilePanel === "chat" ? "mobile-chat-mode" : "mobile-menu-mode"}` : "layout";
  const visibleChats = useMemo(() => {
    if (chatFilter === "CHANNELS") {
      return chats.filter((chat) => chat.kind === "CHANNEL");
    }
    if (chatFilter === "GROUPS") {
      return chats.filter((chat) => chat.kind === "GROUP");
    }
    if (chatFilter === "FAVORITES") {
      return chats.filter((chat) => Boolean(chat.isFavorites));
    }
    return chats.filter((chat) => chat.kind === "DIRECT" && !chat.isFavorites);
  }, [chats, chatFilter]);

  function openChat(chatId: string) {
    setActiveChatId(chatId);
    if (isMobile) {
      setMobilePanel("chat");
    }
  }

  function clearRecorder() {
    if (recorderTimerRef.current) {
      window.clearInterval(recorderTimerRef.current);
      recorderTimerRef.current = null;
    }
    recorderRef.current = null;
    recorderChunksRef.current = [];
    recorderStreamRef.current?.getTracks().forEach((track) => track.stop());
    recorderStreamRef.current = null;
    recordingSecondsRef.current = 0;
    setRecordingMode(null);
    setRecordingSeconds(0);
  }

  function onMessageReceived(message: Message) {
    setMessagesByChat((prev) => {
      const chatMessages = prev[message.chatId] ?? [];
      if (chatMessages.some((item) => item.id === message.id)) {
        return prev;
      }
      return { ...prev, [message.chatId]: [...chatMessages, message] };
    });

    setChats((prev) =>
      sortChats(
        prev.map((chat) =>
          chat.id === message.chatId
            ? {
                ...chat,
                updatedAt: message.createdAt,
                lastMessage: {
                  id: message.id,
                  text: message.text,
                  senderId: message.sender.id,
                  createdAt: message.createdAt,
                  isDeleted: message.isDeleted,
                },
              }
            : chat,
        ),
      ),
    );
  }

  function removeMessageFromUI(chatId: string, messageId: string) {
    setMessagesByChat((prev) => ({
      ...prev,
      [chatId]: (prev[chatId] ?? []).filter((item) => item.id !== messageId),
    }));

    setChats((prev) =>
      prev.map((chat) =>
        chat.id === chatId && chat.lastMessage?.id === messageId ? { ...chat, lastMessage: null } : chat,
      ),
    );
  }

  async function bootstrap(currentToken: string) {
    setLoading(true);
    setError(null);
    try {
      const [meResponse, chatsResponse] = await Promise.all([api.get("/auth/me"), api.get("/chats")]);
      setMe(meResponse.data.user);
      const loaded = sortChats(chatsResponse.data.chats as ChatPreview[]);
      setChats(loaded);
      setActiveChatId((current) => current ?? loaded[0]?.id ?? null);
    } catch (e: any) {
      clearStoredToken();
      setToken(null);
      setError(e?.response?.data?.error ?? "Failed to load account");
      return;
    } finally {
      setLoading(false);
    }

    const socket = createSocket(currentToken);
    socketRef.current = socket;

    socket.on("chat:new", (chat: ChatPreview) => setChats((prev) => upsertChat(prev, chat)));
    socket.on("chat:updated", (chat: ChatPreview) => setChats((prev) => upsertChat(prev, chat)));
    socket.on("message:new", (message: Message) => onMessageReceived(message));
    socket.on("message:updated", (message: Message) => {
      setMessagesByChat((prev) => ({
        ...prev,
        [message.chatId]: (prev[message.chatId] ?? []).map((item) => (item.id === message.id ? message : item)),
      }));
    });
    socket.on("message:deleted", (payload: { messageId: string; chatId: string }) => {
      removeMessageFromUI(payload.chatId, payload.messageId);
    });
    socket.on("message:reactions", (payload: { messageId: string; chatId: string; reactions: Message["reactions"] }) => {
      setMessagesByChat((prev) => ({
        ...prev,
        [payload.chatId]: (prev[payload.chatId] ?? []).map((item) =>
          item.id === payload.messageId ? { ...item, reactions: payload.reactions } : item,
        ),
      }));
    });
  }

  useEffect(() => {
    const media = window.matchMedia(MOBILE_QUERY);
    const onChange = () => setIsMobile(media.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    if (!isMobile) {
      setMobilePanel("menu");
      return;
    }
    if (!activeChatId) {
      setMobilePanel("menu");
    }
  }, [isMobile, activeChatId]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setSystemPrefersDark(media.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = themeMode === "system" ? (systemPrefersDark ? "dark" : "light") : themeMode;
    localStorage.setItem(THEME_KEY, themeMode);
  }, [themeMode, systemPrefersDark]);

  useEffect(() => {
    localStorage.setItem(UI_LANG_KEY, uiLanguage);
  }, [uiLanguage]);

  useEffect(() => {
    if (!token) return;
    void bootstrap(token);
    return () => {
      socketRef.current?.disconnect();
      socketRef.current = null;
    };
  }, [token]);

  useEffect(() => {
    if (!activeChatId || messagesByChat[activeChatId]) return;
    api
      .get(`/chats/${activeChatId}/messages`)
      .then((response) => {
        setMessagesByChat((prev) => ({ ...prev, [activeChatId]: response.data.messages }));
        return api.post(`/chats/${activeChatId}/read`, {});
      })
      .catch(() => setError("Failed to load messages"));
  }, [activeChatId, messagesByChat]);

  useEffect(() => {
    stickToBottomRef.current = true;
  }, [activeChatId]);

  useEffect(() => {
    const viewport = messagesViewportRef.current;
    if (!viewport) return;
    if (!stickToBottomRef.current) return;
    viewport.scrollTop = viewport.scrollHeight;
  }, [activeMessages.length, activeChatId]);

  useEffect(() => {
    const onDocClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (!target.closest(".message-menu") && !target.closest(".message-menu-trigger")) {
        setOpenMessageMenuId(null);
      }
      if (!target.closest(".sidebar-create-menu") && !target.closest(".create-menu-trigger")) {
        setOpenCreateMenu(false);
      }
    };
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, []);

  useEffect(() => {
    if (!error) return;
    const timer = window.setTimeout(() => setError(null), 5000);
    return () => window.clearTimeout(timer);
  }, [error]);

  useEffect(
    () => () => {
      clearRecorder();
    },
    [],
  );

  async function authSubmit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const endpoint = authMode === "login" ? "/auth/login" : "/auth/register";
      const payload =
        authMode === "login"
          ? { phone: phone.trim(), password }
          : {
              phone: phone.trim(),
              password,
              username: username.trim(),
              displayName: (displayName || username).trim(),
            };
      const response = await api.post(endpoint, payload);
      setStoredToken(response.data.token);
      setToken(response.data.token);
    } catch (e: any) {
      setError(e?.response?.data?.error ?? tr("Auth failed", "Ошибка авторизации"));
    } finally {
      setLoading(false);
    }
  }

  async function searchUsers(query: string) {
    setUsersQuery(query);
    if (!query.trim()) {
      setUserResults([]);
      return;
    }
    try {
      const response = await api.get("/users/search", { params: { q: query } });
      setUserResults((response.data.users as User[]).filter((user) => user.id !== me?.id));
    } catch {
      setError("User search failed");
    }
  }

  async function createDirect(userId: string) {
    if (userId === me?.id) {
      setError("Нельзя создать личный чат с собой");
      return;
    }
    try {
      const response = await api.post("/chats/direct", { userId });
      const chat = response.data.chat as ChatPreview;
      setChats((prev) => upsertChat(prev, chat));
      openChat(chat.id);
      setUsersQuery("");
      setUserResults([]);
    } catch (e: any) {
      setError(e?.response?.data?.error ?? "Could not create chat");
    }
  }

  async function openFavorites() {
    try {
      const response = await api.post("/chats/favorites");
      const chat = response.data.chat as ChatPreview;
      setChats((prev) => upsertChat(prev, chat));
      setChatFilter("FAVORITES");
      openChat(chat.id);
    } catch (e: any) {
      setError(e?.response?.data?.error ?? "Could not open favorites");
    }
  }

  async function submitCreateChat(event: FormEvent) {
    event.preventDefault();
    if (!createChatKind || !newChatTitle.trim()) return;
    try {
      const response = await api.post("/chats", {
        kind: createChatKind,
        title: newChatTitle.trim(),
        description: newChatDescription.trim() || null,
      });
      const chat = response.data.chat as ChatPreview;
      setChats((prev) => upsertChat(prev, chat));
      openChat(chat.id);
      setCreateChatKind(null);
      setNewChatTitle("");
      setNewChatDescription("");
    } catch (e: any) {
      setError(e?.response?.data?.error ?? "Could not create chat");
    }
  }
  async function sendMessage() {
    if (!activeChatId) return;
    if (!editingId && !messageText.trim() && !pendingMedia) return;

    try {
      if (editingId) {
        const response = await api.patch(`/messages/${editingId}`, { text: messageText.trim() });
        const updated = response.data.message as Message;
        setMessagesByChat((prev) => ({
          ...prev,
          [updated.chatId]: (prev[updated.chatId] ?? []).map((item) => (item.id === updated.id ? updated : item)),
        }));
        setEditingId(null);
        setMessageText("");
        return;
      }

      const response = await api.post(`/chats/${activeChatId}/messages`, {
        text: messageText.trim() || null,
        mediaType: pendingMedia?.mediaType,
        mediaUrl: pendingMedia?.mediaUrl,
        mediaMeta: pendingMedia?.mediaMeta,
      });
      onMessageReceived(response.data.message as Message);
      setMessageText("");
      setPendingMedia(null);
    } catch (e: any) {
      setError(e?.response?.data?.error ?? "Failed to send");
    }
  }

  async function deleteMessage(messageId: string) {
    try {
      await api.delete(`/messages/${messageId}`);
      if (activeChatId) {
        removeMessageFromUI(activeChatId, messageId);
      }
      setOpenMessageMenuId(null);
    } catch (e: any) {
      setError(e?.response?.data?.error ?? "Failed to delete");
    }
  }

  async function toggleReaction(messageId: string, emoji: string) {
    const message = activeMessages.find((item) => item.id === messageId);
    if (!message || !me) return;

    const reacted = message.reactions.some((reaction) => reaction.emoji === emoji && reaction.userId === me.id);
    try {
      if (reacted) {
        await api.delete(`/messages/${messageId}/reactions/${encodeURIComponent(emoji)}`);
      } else {
        await api.post(`/messages/${messageId}/reactions`, { emoji });
      }
    } catch (e: any) {
      setError(e?.response?.data?.error ?? "Failed to update reaction");
    }
  }

  async function forwardToChat(chatId: string) {
    if (!forwardMessageId) return;
    try {
      await api.post(`/messages/${forwardMessageId}/forward`, { chatId });
      setForwardMessageId(null);
      setOpenMessageMenuId(null);
    } catch (e: any) {
      setError(e?.response?.data?.error ?? "Failed to forward");
    }
  }

  function startEditing(message: Message) {
    if (!message.text || message.isDeleted) return;
    setEditingId(message.id);
    setMessageText(message.text);
    setOpenMessageMenuId(null);
  }

  function openSettings() {
    setSettingsUsername(me?.username ?? "");
    setSettingsDisplayName(me?.displayName ?? "");
    setSettingsBio(me?.bio ?? "");
    setSettingsAvatarUrl(me?.avatarUrl ?? "");
    setSettingsOpen(true);
  }

  async function saveSettings(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const response = await api.patch("/auth/me", {
        username: settingsUsername.trim(),
        displayName: settingsDisplayName.trim(),
        bio: settingsBio.trim() || null,
        avatarUrl: settingsAvatarUrl.trim() || null,
      });
      const updatedUser = response.data.user as User;
      setMe(updatedUser);
      setChats((prev) =>
        prev.map((chat) => ({
          ...chat,
          members: chat.members.map((member) =>
            member.id === updatedUser.id
              ? {
                  ...member,
                  username: updatedUser.username,
                  displayName: updatedUser.displayName,
                  avatarUrl: updatedUser.avatarUrl,
                }
              : member,
          ),
        })),
      );
      setSettingsOpen(false);
    } catch (e: any) {
      setError(e?.response?.data?.error ?? tr("Failed to update settings", "Не удалось обновить настройки"));
    } finally {
      setLoading(false);
    }
  }

  async function onAvatarFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 1_400_000) {
      setError(tr("Avatar file is too large (max 1.4MB)", "Файл аватара слишком большой (макс. 1.4MB)"));
      return;
    }
    try {
      const dataUrl = await toDataUrl(file);
      setSettingsAvatarUrl(dataUrl);
    } catch {
      setError(tr("Failed to read avatar file", "Не удалось прочитать файл аватара"));
    } finally {
      event.target.value = "";
    }
  }

  async function onAttachMedia(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 5_000_000) {
      setError(tr("Media file is too large (max 5MB)", "Медиафайл слишком большой (макс. 5MB)"));
      return;
    }
    try {
      const dataUrl = await toDataUrl(file);
      setPendingMedia({
        mediaType: fileToMediaType(file),
        mediaUrl: dataUrl,
        mediaMeta: { name: file.name, size: file.size, mimeType: file.type },
        name: file.name,
      });
    } catch {
      setError(tr("Failed to attach media", "Не удалось прикрепить медиа"));
    } finally {
      event.target.value = "";
    }
  }

  async function startRecording(mode: RecordingMode) {
    if (recordingMode) return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: mode === "VIDEO" });
      recorderStreamRef.current = stream;
      const candidates =
        mode === "VOICE"
          ? ["audio/webm;codecs=opus", "audio/webm"]
          : ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"];
      const mimeType = candidates.find((item) => MediaRecorder.isTypeSupported(item)) ?? "";
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      recorderRef.current = recorder;
      recorderChunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) recorderChunksRef.current.push(event.data);
      };
      recorder.onstop = async () => {
        try {
          const blob = new Blob(recorderChunksRef.current, {
            type: recorder.mimeType || (mode === "VOICE" ? "audio/webm" : "video/webm"),
          });
          const dataUrl = await toDataUrl(blob);
          setPendingMedia({
            mediaType: mode,
            mediaUrl: dataUrl,
            mediaMeta: {
              name: mode === "VOICE" ? "voice-message.webm" : "video-message.webm",
              durationSeconds: recordingSecondsRef.current,
              size: blob.size,
              mimeType: blob.type,
            },
            name: mode === "VOICE" ? tr("Voice message", "Голосовое сообщение") : tr("Video message", "Видео сообщение"),
          });
        } catch {
          setError(tr("Failed to prepare recording", "Не удалось подготовить запись"));
        } finally {
          clearRecorder();
        }
      };

      recorder.start();
      setRecordingMode(mode);
      setRecordingSeconds(0);
      recordingSecondsRef.current = 0;
      recorderTimerRef.current = window.setInterval(() => {
        recordingSecondsRef.current += 1;
        setRecordingSeconds(recordingSecondsRef.current);
      }, 1000);
    } catch {
      setError(tr("Microphone/camera access denied", "Доступ к микрофону/камере запрещен"));
      clearRecorder();
    }
  }

  function stopRecording() {
    recorderRef.current?.stop();
  }

  function onMessagesScroll() {
    const viewport = messagesViewportRef.current;
    if (!viewport) return;
    const distanceToBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
    stickToBottomRef.current = distanceToBottom < 72;
  }

  function logout() {
    clearStoredToken();
    socketRef.current?.disconnect();
    socketRef.current = null;
    setToken(null);
    setMe(null);
    setChats([]);
    setMessagesByChat({});
    setActiveChatId(null);
    setMessageText("");
    setPendingMedia(null);
    setEditingId(null);
    setError(null);
    clearRecorder();
  }

  if (!token) {
    return (
      <main className="auth-page">
        <section className="auth-card">
          <div className="auth-brand">
            <div className="brand-chip">WG</div>
            <div>
              <h1>Wallgram</h1>
              <p className="hint">{tr("Fast cloud messenger with live sync", "Быстрый облачный мессенджер с синхронизацией")}</p>
            </div>
          </div>
          <form onSubmit={authSubmit}>
            <label>
              {tr("Phone", "Телефон")}
              <input value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="+1..." required />
            </label>
            {authMode === "register" ? (
              <>
                <label>
                  {tr("Username", "Имя пользователя")}
                  <input value={username} onChange={(event) => setUsername(event.target.value)} required />
                </label>
                <label>
                  {tr("Display name", "Отображаемое имя")}
                  <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
                </label>
                <label>
                  {tr("Interface language", "Язык интерфейса")}
                  <select value={uiLanguage} onChange={(event) => setUiLanguage(event.target.value as UiLanguage)}>
                    <option value="ru">Русский</option>
                    <option value="en">English</option>
                  </select>
                </label>
              </>
            ) : null}
            <label>
              {tr("Password", "Пароль")}
              <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" minLength={6} required />
            </label>
            <button className="btn-primary" disabled={loading} type="submit">
              {authMode === "login" ? tr("Sign in", "Войти") : tr("Create account", "Создать аккаунт")}
            </button>
          </form>
          <button className="btn-ghost auth-switch" onClick={() => setAuthMode((prev) => (prev === "login" ? "register" : "login"))} type="button">
            {authMode === "login"
              ? tr("Need an account?", "Нет аккаунта?")
              : tr("Already have an account?", "Уже есть аккаунт?")}
          </button>
          {error ? <p className="error">{error}</p> : null}
        </section>
      </main>
    );
  }

  return (
    <main className={layoutClassName}>
      <input ref={fileInputRef} type="file" accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.txt,.zip" hidden onChange={onAttachMedia} />
      <input ref={avatarFileInputRef} type="file" accept="image/*" hidden onChange={onAvatarFile} />

      <aside className="sidebar">
        <header className="sidebar-header">
          <div className="identity">
            <div className="brand-chip">WG</div>
            <div>
              <strong>{me?.displayName ?? tr("User", "Пользователь")}</strong>
              <p>@{me?.username}</p>
            </div>
          </div>
          <div className="header-actions">
            <button
              className="icon-button create-menu-trigger"
              onClick={() => setOpenCreateMenu((current) => !current)}
              title="Create"
              type="button"
            >
              <PixelIcon name="menu" />
            </button>
            {openCreateMenu ? (
              <div className="sidebar-create-menu animate-in">
                <button
                  onClick={() => {
                    setCreateChatKind("GROUP");
                    setNewChatTitle("");
                    setNewChatDescription("");
                    setOpenCreateMenu(false);
                  }}
                  type="button"
                >
                  <PixelIcon name="group" />
                  {tr("New group", "Новая группа")}
                </button>
                <button
                  onClick={() => {
                    setCreateChatKind("CHANNEL");
                    setNewChatTitle("");
                    setNewChatDescription("");
                    setOpenCreateMenu(false);
                  }}
                  type="button"
                >
                  <PixelIcon name="channel" />
                  {tr("New channel", "Новый канал")}
                </button>
                <button
                  onClick={() => {
                    void openFavorites();
                    setOpenCreateMenu(false);
                  }}
                  type="button"
                >
                  <PixelIcon name="star" />
                  {tr("Open favorites", "Открыть избранное")}
                </button>
              </div>
            ) : null}
            <button className="icon-button" onClick={openSettings} title="Settings" type="button">
              <PixelIcon name="settings" />
            </button>
            <button className="icon-button danger" onClick={logout} title="Log out" type="button">
              <PixelIcon name="logout" />
            </button>
          </div>
        </header>

        <section className="chat-strip">
          <button
            className={chatFilter === "CHATS" ? "chat-strip-button active" : "chat-strip-button"}
            onClick={() => setChatFilter("CHATS")}
            type="button"
          >
            {tr("Chats", "Чаты")}
          </button>
          <button
            className={chatFilter === "CHANNELS" ? "chat-strip-button active" : "chat-strip-button"}
            onClick={() => setChatFilter("CHANNELS")}
            type="button"
          >
            {tr("Channels", "Каналы")}
          </button>
          <button
            className={chatFilter === "GROUPS" ? "chat-strip-button active" : "chat-strip-button"}
            onClick={() => setChatFilter("GROUPS")}
            type="button"
          >
            {tr("Groups", "Группы")}
          </button>
          <button
            className={chatFilter === "FAVORITES" ? "chat-strip-button active" : "chat-strip-button"}
            onClick={() => {
              const hasFavorites = chats.some((chat) => Boolean(chat.isFavorites));
              if (!hasFavorites) {
                void openFavorites();
                return;
              }
              setChatFilter("FAVORITES");
            }}
            type="button"
          >
            {tr("Favorites", "Избранное")}
          </button>
        </section>

        <section className="search">
          <label className="input-wrap">
            <PixelIcon name="search" />
            <input placeholder={tr("Search users...", "Поиск пользователей...")} value={usersQuery} onChange={(event) => void searchUsers(event.target.value)} />
          </label>
          {userResults.length ? (
            <div className="search-results">
              {userResults.map((user) => (
                <button key={user.id} className="search-result" onClick={() => void createDirect(user.id)} type="button">
                  <strong>{user.displayName}</strong>
                  <span>@{user.username}</span>
                </button>
              ))}
            </div>
          ) : null}
        </section>

        <section className="chat-list">
          {loading ? <div className="state-note">{tr("Loading chats...", "Загрузка чатов...")}</div> : null}
          {!loading && !visibleChats.length ? (
            <div className="state-note">
              {chatFilter === "FAVORITES"
                ? tr("No favorites yet.", "В избранном пока пусто.")
                : tr("No chats in this section.", "В этом разделе пока нет чатов.")}
            </div>
          ) : null}
          {visibleChats.map((chat) => (
            <button key={chat.id} type="button" className={chat.id === activeChatId ? "chat-item active" : "chat-item"} onClick={() => openChat(chat.id)}>
              <div className="chat-item-head">
                <span className="kind-pill">
                  <PixelIcon name={chatKindIcon(chat)} />
                  {chatKindLabel(chat, uiLanguage)}
                </span>
                <time>{chat.lastMessage ? formatTime(chat.lastMessage.createdAt) : ""}</time>
              </div>
              <strong>{chatDisplayTitle(chat, uiLanguage)}</strong>
              <span>{formatLastMessage(chat, uiLanguage)}</span>
            </button>
          ))}
        </section>
      </aside>

      <section className="chat-pane">
        {activeChat ? (
          <>
            <header className="chat-header">
              <div className="chat-header-main">
                {isMobile ? (
                  <button className="mobile-back" onClick={() => setMobilePanel("menu")} type="button">
                    <PixelIcon name="back" />
                    <span>{tr("Back", "Назад")}</span>
                  </button>
                ) : null}
                <div>
                  <h2>{chatDisplayTitle(activeChat, uiLanguage)}</h2>
                  <p>{chatKindLabel(activeChat, uiLanguage)} / {activeChat.members.length} {tr("members", "участников")}</p>
                </div>
              </div>
              <small className="chat-id">ID: {activeChat.id}</small>
            </header>

            <div ref={messagesViewportRef} className="messages" onScroll={onMessagesScroll}>
              {activeMessages.filter((message) => !message.isDeleted).map((message) => (
                <article key={message.id} className={message.sender.id === me?.id ? "message own animate-in" : "message animate-in"}>
                  <header>
                    <strong>{message.sender.displayName}</strong>
                    <div className="message-top-right">
                      <time>{formatTime(message.createdAt)}</time>
                      <button className="message-menu-trigger" onClick={() => setOpenMessageMenuId((current) => (current === message.id ? null : message.id))} type="button">
                        <PixelIcon name="menu" />
                      </button>
                    </div>
                  </header>
                  <p>{message.isDeleted ? tr("Message deleted", "Сообщение удалено") : message.text}</p>
                  {message.forwardedFromName ? <small className="meta">{tr("Forwarded from", "Переслано от")} {message.forwardedFromName}</small> : null}
                  {renderMedia(message, uiLanguage)}

                  <div className="message-actions">
                    {REACTIONS.map((emoji) => (
                      <button key={emoji} onClick={() => void toggleReaction(message.id, emoji)} type="button">{emoji}</button>
                    ))}
                  </div>

                  {openMessageMenuId === message.id ? (
                    <div className="message-menu animate-in">
                      <button onClick={() => startEditing(message)} type="button"><PixelIcon name="edit" /> {tr("Edit", "Изменить")}</button>
                      <button onClick={() => { setForwardMessageId(message.id); setOpenMessageMenuId(null); }} type="button"><PixelIcon name="forward" /> {tr("Forward", "Переслать")}</button>
                      <button onClick={() => void deleteMessage(message.id)} type="button"><PixelIcon name="delete" /> {tr("Delete", "Удалить")}</button>
                    </div>
                  ) : null}

                  {summarizeReactions(message.reactions).length ? (
                    <div className="reactions">
                      {summarizeReactions(message.reactions).map(([emoji, count]) => (
                        <button key={emoji} className={message.reactions.some((reaction) => reaction.emoji === emoji && reaction.userId === me?.id) ? "reaction-chip mine" : "reaction-chip"} onClick={() => void toggleReaction(message.id, emoji)} type="button">
                          {emoji} {count}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </article>
              ))}
            </div>

            <footer className="composer composer-advanced">
              <div className="composer-tools">
                <button className="icon-button" onClick={() => fileInputRef.current?.click()} type="button"><PixelIcon name="attach" /></button>
                {recordingMode === "VOICE" ? (
                  <button className="icon-button recording" onClick={stopRecording} type="button"><PixelIcon name="check" /></button>
                ) : (
                  <button className="icon-button" onClick={() => void startRecording("VOICE")} type="button"><PixelIcon name="mic" /></button>
                )}
                {recordingMode === "VIDEO" ? (
                  <button className="icon-button recording" onClick={stopRecording} type="button"><PixelIcon name="check" /></button>
                ) : (
                  <button className="icon-button" onClick={() => void startRecording("VIDEO")} type="button"><PixelIcon name="camera" /></button>
                )}
              </div>

              <div className="composer-main">
                {pendingMedia ? (
                  <div className={pendingMedia.mediaType === "VOICE" ? "media-chip voice animate-in" : "media-chip animate-in"}>
                    <span>{pendingMedia.mediaType}: {pendingMedia.name}</span>
                    <button onClick={() => setPendingMedia(null)} type="button"><PixelIcon name="close" /></button>
                  </div>
                ) : null}
                {recordingMode ? (
                  <div className="recording-indicator animate-in">
                    {tr("Recording", "Запись")} {recordingMode === "VOICE" ? tr("voice", "голоса") : tr("video", "видео")} {formatDuration(recordingSeconds)}
                  </div>
                ) : null}
                <input
                  placeholder={editingId ? tr("Edit message...", "Измените сообщение...") : tr("Write a message...", "Введите сообщение...")}
                  value={messageText}
                  onChange={(event) => setMessageText(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      void sendMessage();
                    }
                  }}
                />
              </div>

              {editingId ? (
                <button className="btn-ghost" type="button" onClick={() => { setEditingId(null); setMessageText(""); }}>
                  {tr("Cancel", "Отмена")}
                </button>
              ) : null}

              <button className="btn-primary send-button" onClick={() => void sendMessage()} type="button">
                <PixelIcon name="send" />
                <span>{editingId ? tr("Save", "Сохранить") : tr("Send", "Отправить")}</span>
              </button>
            </footer>
          </>
        ) : (
          <div className="empty">
            <div className="empty-card animate-in">
              <div className="empty-icon-wrap">
                <PixelIcon name="message" size={36} />
              </div>
              <p className="empty-title">{tr("Select or create a chat.", "Выберите или создайте чат.")}</p>
            </div>
          </div>
        )}
      </section>

      {createChatKind ? (
        <div className="settings-overlay" onClick={() => setCreateChatKind(null)}>
          <section className="settings-panel animate-in" onClick={(event) => event.stopPropagation()}>
            <header className="settings-header">
              <h3>{createChatKind === "GROUP" ? tr("New group", "Новая группа") : tr("New channel", "Новый канал")}</h3>
              <button className="icon-button" onClick={() => setCreateChatKind(null)} type="button"><PixelIcon name="close" /></button>
            </header>
            <form className="settings-form" onSubmit={submitCreateChat}>
              <label>{tr("Title", "Название")}<input value={newChatTitle} onChange={(event) => setNewChatTitle(event.target.value)} required /></label>
              <label>{tr("Description", "Описание")}<textarea rows={3} value={newChatDescription} onChange={(event) => setNewChatDescription(event.target.value)} /></label>
              <button className="btn-primary" type="submit">{tr("Create", "Создать")}</button>
            </form>
          </section>
        </div>
      ) : null}

      {forwardMessageId ? (
        <div className="settings-overlay" onClick={() => setForwardMessageId(null)}>
          <section className="settings-panel animate-in" onClick={(event) => event.stopPropagation()}>
            <header className="settings-header">
              <h3>{tr("Forward message", "Переслать сообщение")}</h3>
              <button className="icon-button" onClick={() => setForwardMessageId(null)} type="button"><PixelIcon name="close" /></button>
            </header>
            <div className="forward-list">
              {chats.map((chat) => (
                <button key={chat.id} className="forward-item" onClick={() => void forwardToChat(chat.id)} type="button">
                  <span className="kind-pill"><PixelIcon name={chatKindIcon(chat)} />{chatKindLabel(chat, uiLanguage)}</span>
                  <strong>{chatDisplayTitle(chat, uiLanguage)}</strong>
                </button>
              ))}
            </div>
          </section>
        </div>
      ) : null}

      {settingsOpen ? (
        <div className="settings-overlay" onClick={() => setSettingsOpen(false)}>
          <section className="settings-panel animate-in" onClick={(event) => event.stopPropagation()}>
            <header className="settings-header">
              <h3>{tr("Settings", "Настройки")}</h3>
              <button className="icon-button" onClick={() => setSettingsOpen(false)} type="button"><PixelIcon name="close" /></button>
            </header>
            <form className="settings-form" onSubmit={saveSettings}>
              <div className="avatar-row">
                <div className="avatar-preview">{settingsAvatarUrl ? <img src={settingsAvatarUrl} alt="avatar" /> : <span>{tr("No avatar", "Без аватара")}</span>}</div>
                <button className="btn-ghost" onClick={() => avatarFileInputRef.current?.click()} type="button">{tr("Choose file", "Выбрать файл")}</button>
              </div>
              <label>{tr("Username", "Имя пользователя")}<input value={settingsUsername} onChange={(event) => setSettingsUsername(event.target.value)} minLength={3} maxLength={32} required /></label>
              <label>{tr("Display name", "Отображаемое имя")}<input value={settingsDisplayName} onChange={(event) => setSettingsDisplayName(event.target.value)} required /></label>
              <label>{tr("Bio", "О себе")}<textarea value={settingsBio} onChange={(event) => setSettingsBio(event.target.value)} rows={3} /></label>
              <label>{tr("Avatar URL", "Ссылка на аватар")}<input value={settingsAvatarUrl} onChange={(event) => setSettingsAvatarUrl(event.target.value)} placeholder="https://... or data:image/*" /></label>

              <fieldset className="theme-fieldset">
                <legend>{tr("Language", "Язык")}</legend>
                <label>
                  <input type="radio" name="language" checked={uiLanguage === "ru"} onChange={() => setUiLanguage("ru")} />
                  Русский
                </label>
                <label>
                  <input type="radio" name="language" checked={uiLanguage === "en"} onChange={() => setUiLanguage("en")} />
                  English
                </label>
              </fieldset>

              <fieldset className="theme-fieldset">
                <legend>{tr("Theme", "Тема")}</legend>
                <label><input type="radio" name="theme" checked={themeMode === "system"} onChange={() => setThemeMode("system")} /><PixelIcon name="system" />{tr("System", "Системная")}</label>
                <label><input type="radio" name="theme" checked={themeMode === "light"} onChange={() => setThemeMode("light")} /><PixelIcon name="sun" />{tr("Light", "Светлая")}</label>
                <label><input type="radio" name="theme" checked={themeMode === "dark"} onChange={() => setThemeMode("dark")} /><PixelIcon name="moon" />{tr("Dark", "Темная")}</label>
              </fieldset>

              <button className="btn-primary" disabled={loading} type="submit">{tr("Save changes", "Сохранить изменения")}</button>
            </form>
          </section>
        </div>
      ) : null}

      {error ? <div className="toast">{error}</div> : null}
    </main>
  );
}

