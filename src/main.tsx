import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, Navigate } from "react-router";
import { RouterProvider } from "react-router/dom";
import { ApiError } from "./api";
import { Layout } from "./components/Layout";
import { AccountPage } from "./pages/AccountPage";
import { DiaryPage } from "./pages/DiaryPage";
import { ProductEditPage } from "./pages/ProductEditPage";
import { ProductsPage } from "./pages/ProductsPage";
import { ReceiptEditPage } from "./pages/ReceiptEditPage";
import { ReceiptsPage } from "./pages/ReceiptsPage";
import { ShoppingPage } from "./pages/ShoppingPage";
import { StatsPage } from "./pages/StatsPage";
import { StoresPage } from "./pages/StoresPage";
import "./index.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      // Retrying a 4xx (or an expired session) never helps.
      retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
    },
  },
});

const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { index: true, element: <Navigate to="/diario" replace /> },
      { path: "spesa", element: <ShoppingPage /> },
      { path: "spesa/scontrini", element: <ReceiptsPage /> },
      // Distinct keys: switching between these routes must remount the page (e.g. scan review → saved receipt).
      { path: "scontrini/nuovo", element: <ReceiptEditPage key="new" /> },
      { path: "scontrini/scansione", element: <ReceiptEditPage key="scan" scan /> },
      { path: "scontrini/:id", element: <ReceiptEditPage key="edit" /> },
      // Old addresses (bookmarks, installed PWA)
      { path: "lista", element: <Navigate to="/spesa" replace /> },
      { path: "account", element: <Navigate to="/altro" replace /> },
      { path: "diario", element: <DiaryPage /> },
      { path: "prodotti", element: <ProductsPage /> },
      { path: "prodotti/nuovo", element: <ProductEditPage /> },
      { path: "prodotti/:id", element: <ProductEditPage /> },
      { path: "negozi", element: <StoresPage /> },
      { path: "statistiche", element: <StatsPage /> },
      { path: "altro", element: <AccountPage /> },
    ],
  },
]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
