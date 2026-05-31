/** Tipos de navegação partilhados (parâmetros de rota). */
export type RootTabParamList = {
  Dashboard: undefined;
  Encomendas: undefined;
  Gestao: undefined;
  Definicoes: undefined;
};

export type OrdersStackParamList = {
  OrdersList: undefined;
  OrderDetail: { id: string; orderNumber?: string };
};
