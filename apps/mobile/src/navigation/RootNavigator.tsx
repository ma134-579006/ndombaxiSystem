import { Ionicons } from '@expo/vector-icons';
import { DarkTheme, NavigationContainer, type Theme as NavTheme } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import React from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useAuth } from '../auth/AuthContext';
import { ScreenBackground } from '../components/Background';
import { DashboardScreen } from '../screens/DashboardScreen';
import { LoginScreen } from '../screens/LoginScreen';
import { ManagementScreen } from '../screens/ManagementScreen';
import { OrderDetailScreen } from '../screens/OrderDetailScreen';
import { OrdersScreen } from '../screens/OrdersScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { theme } from '../theme';
import type { OrdersStackParamList, RootTabParamList } from './types';

const navTheme: NavTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: theme.colors.bg,
    card: theme.colors.bg,
    text: theme.colors.text,
    border: theme.colors.border,
    primary: theme.colors.primary,
    notification: theme.colors.primary,
  },
};

const AuthStack = createNativeStackNavigator<{ Login: undefined }>();
const OrdersStack = createNativeStackNavigator<OrdersStackParamList>();
const Tab = createBottomTabNavigator<RootTabParamList>();

function OrdersNavigator() {
  return (
    <OrdersStack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: theme.colors.bg },
        headerTintColor: theme.colors.text,
        headerShadowVisible: false,
        contentStyle: { backgroundColor: theme.colors.bg },
      }}
    >
      <OrdersStack.Screen name="OrdersList" component={OrdersScreen} options={{ headerShown: false }} />
      <OrdersStack.Screen
        name="OrderDetail"
        component={OrderDetailScreen}
        options={({ route }) => ({
          title: route.params.orderNumber ? `Encomenda ${route.params.orderNumber}` : 'Encomenda',
        })}
      />
    </OrdersStack.Navigator>
  );
}

const TAB_ICON: Record<keyof RootTabParamList, { on: keyof typeof Ionicons.glyphMap; off: keyof typeof Ionicons.glyphMap }> = {
  Dashboard: { on: 'grid', off: 'grid-outline' },
  Encomendas: { on: 'cart', off: 'cart-outline' },
  Gestao: { on: 'people', off: 'people-outline' },
  Definicoes: { on: 'settings', off: 'settings-outline' },
};

/** Papéis que veem a área de Gestão (equipa & lojas): gestor de loja e acima. */
const MANAGER_ROLES = ['COMPANY_ADMIN', 'REGIONAL_MANAGER', 'STORE_MANAGER'];

function AppTabs() {
  const { user } = useAuth();
  const canManage = user?.role ? MANAGER_ROLES.includes(user.role) : false;
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: theme.colors.primary,
        tabBarInactiveTintColor: theme.colors.muted,
        tabBarStyle: {
          backgroundColor: theme.colors.surface,
          borderTopColor: theme.colors.border,
          height: 62,
          paddingBottom: 8,
          paddingTop: 6,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
        tabBarIcon: ({ focused, color, size }) => {
          const set = TAB_ICON[route.name];
          return <Ionicons name={focused ? set.on : set.off} size={size} color={color} />;
        },
      })}
    >
      <Tab.Screen name="Dashboard" component={DashboardScreen} options={{ title: 'Painel' }} />
      <Tab.Screen name="Encomendas" component={OrdersNavigator} options={{ title: 'Encomendas' }} />
      {canManage ? (
        <Tab.Screen name="Gestao" component={ManagementScreen} options={{ title: 'Gestão' }} />
      ) : null}
      <Tab.Screen name="Definicoes" component={SettingsScreen} options={{ title: 'Definições' }} />
    </Tab.Navigator>
  );
}

function AuthNavigator() {
  return (
    <AuthStack.Navigator screenOptions={{ headerShown: false }}>
      <AuthStack.Screen name="Login" component={LoginScreen} />
    </AuthStack.Navigator>
  );
}

export function RootNavigator() {
  const { status } = useAuth();

  if (status === 'loading') {
    return (
      <ScreenBackground>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
        </View>
      </ScreenBackground>
    );
  }

  return (
    <NavigationContainer theme={navTheme}>
      {status === 'authed' ? <AppTabs /> : <AuthNavigator />}
    </NavigationContainer>
  );
}
