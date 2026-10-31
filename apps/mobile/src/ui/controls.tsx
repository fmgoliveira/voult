import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Animated,
  Dimensions,
  Easing,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from './kit';
import { useTheme } from './theme';

// ------------------------------------------------------------------ toggle / checkbox

/** Our own switch (the platform one ignores the theme and looks out of place). */
export function Toggle({
  value,
  onValueChange,
  disabled,
  accessibilityLabel,
  testID,
}: {
  value: boolean;
  onValueChange: (v: boolean) => void;
  disabled?: boolean;
  accessibilityLabel: string;
  testID?: string;
}) {
  const { c } = useTheme();
  const t = useRef(new Animated.Value(value ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(t, {
      toValue: value ? 1 : 0,
      duration: 160,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  }, [value, t]);
  return (
    <Pressable
      testID={testID}
      accessibilityRole="switch"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ checked: value, disabled: !!disabled }}
      disabled={disabled}
      hitSlop={8}
      onPress={() => onValueChange(!value)}
      style={{ opacity: disabled ? 0.45 : 1 }}
    >
      <View
        style={{
          width: 48,
          height: 28,
          borderRadius: 14,
          backgroundColor: c.borderStrong,
          justifyContent: 'center',
          overflow: 'hidden',
        }}
      >
        <Animated.View
          style={[StyleSheet.absoluteFill, { backgroundColor: c.primary, opacity: t }]}
        />
        <Animated.View
          style={{
            width: 22,
            height: 22,
            borderRadius: 11,
            backgroundColor: '#fff',
            transform: [
              { translateX: t.interpolate({ inputRange: [0, 1], outputRange: [3, 23] }) },
            ],
          }}
        />
      </View>
    </Pressable>
  );
}

/** Square tick box with a label on its right (for "I understand…" style confirmations). */
export function CheckRow({
  value,
  onValueChange,
  children,
  testID,
}: {
  value: boolean;
  onValueChange: (v: boolean) => void;
  children: ReactNode;
  testID?: string;
}) {
  const { c } = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: value }}
      onPress={() => onValueChange(!value)}
      style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start' }}
    >
      <View
        style={{
          width: 24,
          height: 24,
          borderRadius: 8,
          borderWidth: 1.5,
          borderColor: value ? c.primary : c.borderStrong,
          backgroundColor: value ? c.primary : 'transparent',
          alignItems: 'center',
          justifyContent: 'center',
          marginTop: 1,
        }}
      >
        {value ? <Ionicons name="checkmark" size={16} color={c.primaryForeground} /> : null}
      </View>
      <View style={{ flex: 1 }}>{children}</View>
    </Pressable>
  );
}

// ------------------------------------------------------------------ slider

/** Horizontal slider with integer steps. */
export function Slider({
  value,
  min,
  max,
  onChange,
  accessibilityLabel,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (n: number) => void;
  accessibilityLabel: string;
}) {
  const { c } = useTheme();
  const [width, setWidth] = useState(0);
  const live = useRef({ width, min, max, onChange });
  live.current = { width, min, max, onChange };
  const start = useRef(0);

  const pan = useMemo(() => {
    const set = (x: number) => {
      const { width: w, min: lo, max: hi, onChange: cb } = live.current;
      if (!w) return;
      const r = Math.min(1, Math.max(0, x / w));
      cb(Math.round(lo + r * (hi - lo)));
    };
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => {
        start.current = e.nativeEvent.locationX;
        set(start.current);
      },
      onPanResponderMove: (_e, g) => set(start.current + g.dx),
    });
  }, []);

  const ratio = (value - min) / (max - min);
  return (
    <View
      {...pan.panHandlers}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ min, max, now: value }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(e) => {
        const d = e.nativeEvent.actionName === 'increment' ? 1 : -1;
        onChange(Math.min(max, Math.max(min, value + d)));
      }}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      style={{ height: 36, justifyContent: 'center' }}
    >
      <View pointerEvents="none" style={{ height: 6, borderRadius: 3, backgroundColor: c.border }}>
        <View
          style={{
            width: `${ratio * 100}%`,
            height: 6,
            borderRadius: 3,
            backgroundColor: c.primary,
          }}
        />
      </View>
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          left: Math.max(0, ratio * width - 12),
          width: 24,
          height: 24,
          borderRadius: 12,
          backgroundColor: '#fff',
          borderWidth: 2,
          borderColor: c.primary,
        }}
      />
    </View>
  );
}

// ------------------------------------------------------------------ bottom sheet

const SCREEN_H = Dimensions.get('window').height;

/** Bottom drawer: slides up over a dimmed backdrop; tap the backdrop, swipe down or press back to close. */
export function Sheet({
  visible,
  onClose,
  title,
  children,
  testID,
}: {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  testID?: string;
}) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const [mounted, setMounted] = useState(visible);
  const progress = useRef(new Animated.Value(0)).current;
  const drag = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      setMounted(true);
      drag.setValue(0);
      Animated.timing(progress, {
        toValue: 1,
        duration: 260,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    } else {
      Animated.timing(progress, {
        toValue: 0,
        duration: 200,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }).start(({ finished }) => finished && setMounted(false));
    }
  }, [visible, progress, drag]);

  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const swipe = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_e, g) => g.dy > 4,
        onPanResponderMove: (_e, g) => drag.setValue(Math.max(0, g.dy)),
        onPanResponderRelease: (_e, g) => {
          if (g.dy > 90 || g.vy > 0.9) closeRef.current();
          else Animated.spring(drag, { toValue: 0, useNativeDriver: true }).start();
        },
      }),
    [drag],
  );

  if (!mounted) return null;
  return (
    <Modal transparent visible statusBarTranslucent animationType="none" onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Animated.View
          style={[
            StyleSheet.absoluteFill,
            {
              backgroundColor: '#000',
              opacity: progress.interpolate({ inputRange: [0, 1], outputRange: [0, 0.5] }),
            },
          ]}
        >
          <Pressable accessibilityLabel="Close" style={{ flex: 1 }} onPress={onClose} />
        </Animated.View>
        <KeyboardAvoidingView behavior="padding">
          <Animated.View
            testID={testID}
            style={{
              backgroundColor: c.surfaceSolid,
              borderTopLeftRadius: 28,
              borderTopRightRadius: 28,
              borderWidth: StyleSheet.hairlineWidth,
              borderBottomWidth: 0,
              borderColor: c.borderStrong,
              maxHeight: SCREEN_H * 0.9,
              paddingBottom: Math.max(insets.bottom, 12) + 8,
              transform: [
                {
                  translateY: Animated.add(
                    progress.interpolate({ inputRange: [0, 1], outputRange: [SCREEN_H, 0] }),
                    drag,
                  ),
                },
              ],
            }}
          >
            <View {...swipe.panHandlers} style={{ paddingTop: 10, paddingBottom: 6 }}>
              <View
                style={{
                  alignSelf: 'center',
                  width: 40,
                  height: 4,
                  borderRadius: 2,
                  backgroundColor: c.borderStrong,
                }}
              />
              {title ? (
                <Text
                  accessibilityRole="header"
                  style={{
                    color: c.foreground,
                    fontSize: 18,
                    fontWeight: '800',
                    letterSpacing: -0.2,
                    paddingHorizontal: 20,
                    paddingTop: 14,
                  }}
                >
                  {title}
                </Text>
              ) : null}
            </View>
            {children}
          </Animated.View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

/** Confirmation in a drawer (replaces the system alert dialog). */
export function ConfirmSheet({
  visible,
  title,
  message,
  confirmLabel,
  destructive,
  onConfirm,
  onClose,
}: {
  visible: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  destructive?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const { c } = useTheme();
  return (
    <Sheet visible={visible} onClose={onClose} title={title}>
      <View style={{ paddingHorizontal: 20, paddingTop: 4, gap: 16 }}>
        <Text style={{ color: c.muted, fontSize: 15, lineHeight: 21 }}>{message}</Text>
        <View style={{ gap: 10 }}>
          <Button
            variant={destructive ? 'danger' : 'primary'}
            label={confirmLabel}
            onPress={() => {
              onClose();
              onConfirm();
            }}
          />
          <Button variant="secondary" label="Cancel" onPress={onClose} />
        </View>
      </View>
    </Sheet>
  );
}

export const PIN_LENGTH = 6;

/** Six-slot code input. Typing the last digit calls `onComplete`; there is no submit button. */
export function OtpInput({
  value,
  onChange,
  onComplete,
  autoFocus,
  disabled,
  mask = true,
  accessibilityLabel,
  testID,
}: {
  value: string;
  onChange: (v: string) => void;
  onComplete?: (v: string) => void;
  autoFocus?: boolean;
  disabled?: boolean;
  /** Show dots instead of the digits. */
  mask?: boolean;
  accessibilityLabel: string;
  testID?: string;
}) {
  const { c } = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <View style={{ opacity: disabled ? 0.5 : 1 }}>
      <View
        pointerEvents="none"
        style={{ flexDirection: 'row', justifyContent: 'center', gap: 10 }}
      >
        {Array.from({ length: PIN_LENGTH }, (_, i) => {
          const active = focused && i === Math.min(value.length, PIN_LENGTH - 1);
          const ch = value[i];
          return (
            <View
              key={i}
              style={{
                width: 44,
                height: 56,
                borderRadius: 14,
                borderWidth: active ? 2 : 1,
                borderColor: active ? c.primary : c.borderStrong,
                backgroundColor: c.surface,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {ch ? (
                mask ? (
                  <View
                    style={{
                      width: 11,
                      height: 11,
                      borderRadius: 6,
                      backgroundColor: c.foreground,
                    }}
                  />
                ) : (
                  <Text style={{ color: c.foreground, fontSize: 22, fontWeight: '700' }}>{ch}</Text>
                )
              ) : null}
            </View>
          );
        })}
      </View>
      <TextInput
        testID={testID}
        accessibilityLabel={accessibilityLabel}
        value={value}
        editable={!disabled}
        autoFocus={autoFocus}
        keyboardType="number-pad"
        maxLength={PIN_LENGTH}
        caretHidden
        contextMenuHidden
        importantForAutofill="no"
        autoComplete="off"
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChangeText={(t) => {
          const v = t.replace(/\D/g, '').slice(0, PIN_LENGTH);
          onChange(v);
          if (v.length === PIN_LENGTH) onComplete?.(v);
        }}
        // Invisible, but covers the slots so a tap anywhere on them opens the keyboard.
        style={[StyleSheet.absoluteFill, { opacity: 0.02, color: 'transparent' }]}
      />
    </View>
  );
}
