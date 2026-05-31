import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { theme } from '../../theme';

export type KeyboardLayout = 'text' | 'numeric';

interface VirtualKeyboardProps {
  layout: KeyboardLayout;
  onInsert(ch: string): void;
  onBackspace(): void;
  onClear(): void;
  onSubmit(): void;
  onHide(): void;
  submitLabel?: string;
}

const LETTER_ROWS = [
  ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
  ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', 'ç'],
  ['z', 'x', 'c', 'v', 'b', 'n', 'm'],
];

const SYMBOL_ROWS = [
  ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
  ['@', '#', '€', '_', '&', '-', '+', '(', ')', '/'],
  ['*', '"', "'", ':', ';', '!', '?'],
];

const NUMERIC_ROWS = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
];

/** Uma tecla individual com área de toque ampla (terminais táteis). */
function Key({
  label,
  icon,
  onPress,
  flex = 1,
  tone = 'default',
}: {
  label?: string;
  icon?: keyof typeof Ionicons.glyphMap;
  onPress(): void;
  flex?: number;
  tone?: 'default' | 'accent' | 'action';
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.key,
        tone === 'accent' && styles.keyAccent,
        tone === 'action' && styles.keyAction,
        { flex },
        pressed && styles.keyPressed,
      ]}
      android_ripple={{ color: '#FFFFFF22' }}
    >
      {icon ? (
        <Ionicons name={icon} size={20} color={theme.colors.text} />
      ) : (
        <Text style={[styles.keyLabel, tone === 'accent' && styles.keyLabelAccent]}>{label}</Text>
      )}
    </Pressable>
  );
}

/**
 * Teclado virtual completo (QWERTY + símbolos) ou numérico, desenhado para
 * PCs/terminais táteis sem teclado físico. É controlado: comunica as teclas
 * premidas através das callbacks recebidas.
 */
export function VirtualKeyboard({
  layout,
  onInsert,
  onBackspace,
  onClear,
  onSubmit,
  onHide,
  submitLabel = 'OK',
}: VirtualKeyboardProps) {
  const [mode, setMode] = useState<'letters' | 'symbols'>('letters');
  const [shift, setShift] = useState(false);

  const renderTopBar = (
    <View style={styles.topBar}>
      <Text style={styles.topBarText}>Teclado no ecrã</Text>
      <View style={styles.topBarActions}>
        <Pressable onPress={onClear} style={styles.topBtn} hitSlop={8}>
          <Text style={styles.topBtnText}>Limpar</Text>
        </Pressable>
        <Pressable onPress={onHide} style={styles.topBtn} hitSlop={8}>
          <Ionicons name="chevron-down" size={20} color={theme.colors.muted} />
        </Pressable>
      </View>
    </View>
  );

  if (layout === 'numeric') {
    return (
      <View style={styles.wrap}>
        {renderTopBar}
        {NUMERIC_ROWS.map((row) => (
          <View key={row.join()} style={styles.row}>
            {row.map((ch) => (
              <Key key={ch} label={ch} onPress={() => onInsert(ch)} />
            ))}
          </View>
        ))}
        <View style={styles.row}>
          <Key label="." onPress={() => onInsert('.')} />
          <Key label="0" onPress={() => onInsert('0')} />
          <Key icon="backspace-outline" onPress={onBackspace} tone="action" />
        </View>
        <View style={styles.row}>
          <Key label={submitLabel} onPress={onSubmit} tone="accent" flex={1} />
        </View>
      </View>
    );
  }

  const rows = mode === 'letters' ? LETTER_ROWS : SYMBOL_ROWS;
  const display = (ch: string) => (mode === 'letters' && shift ? ch.toUpperCase() : ch);

  return (
    <View style={styles.wrap}>
      {renderTopBar}
      <View style={styles.row}>
        {rows[0].map((ch) => (
          <Key key={ch} label={display(ch)} onPress={() => onInsert(display(ch))} />
        ))}
      </View>
      <View style={styles.row}>
        {rows[1].map((ch) => (
          <Key key={ch} label={display(ch)} onPress={() => onInsert(display(ch))} />
        ))}
      </View>
      <View style={styles.row}>
        {mode === 'letters' ? (
          <Key
            icon={shift ? 'arrow-up' : 'arrow-up-outline'}
            onPress={() => setShift((s) => !s)}
            tone={shift ? 'accent' : 'action'}
            flex={1.5}
          />
        ) : (
          <View style={{ flex: 1.5 }} />
        )}
        {rows[2].map((ch) => (
          <Key key={ch} label={display(ch)} onPress={() => onInsert(display(ch))} />
        ))}
        <Key icon="backspace-outline" onPress={onBackspace} tone="action" flex={1.5} />
      </View>
      <View style={styles.row}>
        <Key
          label={mode === 'letters' ? '?123' : 'ABC'}
          onPress={() => setMode((m) => (m === 'letters' ? 'symbols' : 'letters'))}
          tone="action"
          flex={1.6}
        />
        <Key label="," onPress={() => onInsert(',')} />
        <Key label="espaço" onPress={() => onInsert(' ')} flex={4} />
        <Key label="." onPress={() => onInsert('.')} />
        <Key label={submitLabel} onPress={onSubmit} tone="accent" flex={1.6} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: theme.colors.surfaceAlt,
    paddingHorizontal: 6,
    paddingTop: 6,
    paddingBottom: 10,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 6,
    paddingBottom: 6,
  },
  topBarText: { color: theme.colors.muted, fontSize: 12, fontWeight: '600' },
  topBarActions: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  topBtn: { paddingHorizontal: 4, paddingVertical: 2 },
  topBtnText: { color: theme.colors.muted, fontSize: 12, fontWeight: '600' },
  row: { flexDirection: 'row', gap: 5, marginTop: 5 },
  key: {
    height: 46,
    borderRadius: 8,
    backgroundColor: theme.colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  keyPressed: { opacity: 0.6 },
  keyAccent: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
  keyAction: { backgroundColor: theme.colors.bg },
  keyLabel: { color: theme.colors.text, fontSize: 16, fontWeight: '600' },
  keyLabelAccent: { color: theme.colors.primaryText, fontWeight: '700' },
});
