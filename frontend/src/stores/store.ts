import { combineReducers, configureStore } from "@reduxjs/toolkit";
import storage from "redux-persist/lib/storage";
import { createTransform, persistReducer, persistStore, type PersistConfig } from "redux-persist";

import authReducer from "@/features/auth/store/authSlice";

// App-wide Redux state: the signed-in user (persisted). Every other screen
// keeps its state in its own hooks.

const rootReducer = combineReducers({
	auth: authReducer,
});

type RootReducerState = ReturnType<typeof rootReducer>;
type AuthPersisted = RootReducerState["auth"];

// A request in flight is never saved or restored: auth.loading left true by a
// page that unloaded mid-login (or mid-logout) used to come back on every
// visit as a spinning, disabled Sign In button.
const authRequestState = createTransform<AuthPersisted, AuthPersisted, RootReducerState, RootReducerState>(
	(inbound) => ({ ...inbound, loading: false, error: null }),
	(outbound) => ({ ...outbound, loading: false, error: null }),
	{ whitelist: ["auth"] }
);

const persistConfig: PersistConfig<RootReducerState> = {
	key: "root",
	storage,
	transforms: [authRequestState],
	whitelist: ["auth"],
};

// A separate constant on purpose: written inline in configureStore() next to
// the middleware callback, TypeScript infers the store's state as `any`.
const persistedReducer = persistReducer(persistConfig, rootReducer);

export const store = configureStore({
	reducer: persistedReducer,
	middleware: (getDefaultMiddleware) => getDefaultMiddleware({ serializableCheck: false }),
});

export const persistor = persistStore(store);

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
