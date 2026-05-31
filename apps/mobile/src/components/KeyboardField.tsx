import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import {
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  type TextStyle,
  View,
  type ViewStyle,
} from 'react-native';
import { theme } from '../theme';
import { useKeyboardScope } from './keyboard/KeyboardScope';

interface KeyboardFieldProps {
  value: string;
  onChangeText(text: string): void;
  label?: string;
  placeholder?: string;
  secureTextEntry?: boolean;
  /** Usa o esquema numérico (no ecrã) e number-pad (físico). */
  numeric?: boolean;
  autoCapitalize?: TextInputProps['autoCapitalize'];
  autoCorrect?: boolean;
  maxLength?: number;
  multiline?: boolean;
  onSubmitEditing?(): void;
  submitLabel?: string;
  returnKeyType?: TextInputProps['returnKeyType'];
  icon?: keyof typeof Ionicons.glyphMap;
  editable?: boolean;
  autoFocus?: boolean;
  containerStyle?: ViewStyle;
  inputStyle?: TextStyle;
}

/**
 * Campo de texto que respeita a preferência "Teclado no ecrã". Quando activo,
 * suprime o teclado do sistema (`showSoftInputOnFocus={false}`) e encaminha as
 * teclas do teclado virtual partilhado; caso contrário, comporta-se como um
 * TextInput normal com o teclado do dispositivo.
 */
export function KeyboardField(props: KeyboardFieldProps) {
  const kbd = useKeyboardScope();
  const id = useId();
  const inputRef = useRef<TextInput>(null);
  const [focused, setFocused] = useState(false);

  // Refs sempre frescas para as callbacks estáveis registadas no teclado.
  const valueRef = useRef(props.value);
  valueRef.current = props.value;
  const changeRef = useRef(props.onChangeText);
  changeRef.current = props.onChangeText;
  const submitRef = useRef(props.onSubmitEditing);
  submitRef.current = props.onSubmitEditing;
  const maxRef = useRef(props.maxLength);
  maxRef.current = props.maxLength;
  const kbdRef = useRef(kbd);
  kbdRef.current = kbd;

  const insert = useCallback((ch: string) => {
    const max = maxRef.current;
    if (max != null && valueRef.current.length >= max) return;
    changeRef.current(valueRef.current + ch);
  }, []);
  const backspace = useCallback(() => changeRef.current(valueRef.current.slice(0, -1)), []);
  const clear = useCallback(() => changeRef.current(''), []);
  const submit = useCallback(() => submitRef.current?.(), []);

  const layout = props.numeric ? 'numeric' : 'text';

  const handleFocus = useCallback(() => {
    setFocused(true);
    if (kbdRef.current.enabled) {
      kbdRef.current.open({
        id,
        layout,
        submitLabel: props.submitLabel,
        insert,
        backspace,
        clear,
        submit,
      });
    }
  }, [id, layout, props.submitLabel, insert, backspace, clear, submit]);

  const handleBlur = useCallback(() => setFocused(false), []);

  // Ao desmontar, fecha o teclado se este campo era o activo.
  useEffect(
    () => () => {
      if (kbdRef.current.activeId === id) kbdRef.current.close();
    },
    [id],
  );

  const active = focused || kbd.activeId === id;

  return (
    <View style={props.containerStyle}>
      {props.label ? <Text style={styles.label}>{props.label}</Text> : null}
      <View
        style={[
          styles.box,
          props.multiline && styles.boxMultiline,
          active && styles.boxActive,
        ]}
      >
        {props.icon ? (
          <Ionicons name={props.icon} size={18} color={theme.colors.muted} style={styles.icon} />
        ) : null}
        <TextInput
          ref={inputRef}
          value={props.value}
          onChangeText={props.onChangeText}
          placeholder={props.placeholder}
          placeholderTextColor={theme.colors.muted}
          secureTextEntry={props.secureTextEntry}
          maxLength={props.maxLength}
          editable={props.editable}
          autoFocus={props.autoFocus}
          multiline={props.multiline}
          autoCapitalize={props.autoCapitalize}
          autoCorrect={props.autoCorrect}
          keyboardType={props.numeric ? 'number-pad' : 'default'}
          returnKeyType={props.returnKeyType}
          onSubmitEditing={props.onSubmitEditing}
          // Suprime o teclado do SO quando o teclado no ecrã está activo.
          showSoftInputOnFocus={!kbd.enabled}
          onFocus={handleFocus}
          onBlur={handleBlur}
          style={[styles.input, props.multiline && styles.inputMultiline, props.inputStyle]}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  label: {
    color: theme.colors.muted,
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 6,
    marginLeft: 2,
  },
  box: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius,
    borderWidth: 1,
    borderColor: theme.colors.border,
    paddingHorizontal: 12,
    minHeight: 50,
  },
  boxMultiline: { alignItems: 'flex-start', paddingVertical: 6 },
  boxActive: { borderColor: theme.colors.primary },
  icon: { marginRight: 8 },
  input: {
    flex: 1,
    color: theme.colors.text,
    fontSize: 16,
    paddingVertical: 12,
  },
  inputMultiline: { minHeight: 44, maxHeight: 120, textAlignVertical: 'top' },
});
