
import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import fs from 'fs';

const app = express();
const PORT = 3000;

// simple in-memory DB for simulation
const MOCK_DB: Record<string, any[]> = {};
const dbPath = path.join(process.cwd(), 'mock_db.json');
if (fs.existsSync(dbPath)) {
    try {
        const data = JSON.parse(fs.readFileSync(dbPath, 'utf-8'));
        Object.assign(MOCK_DB, data);
    } catch(e) {}
}

const saveDB = () => {
    fs.writeFileSync(dbPath, JSON.stringify(MOCK_DB, null, 2));
};

// --- GAS Simulators ---
const _DB_SIM = {
    get: (table: string) => MOCK_DB[table] || [],
    save: (table: string, id: string, data: any) => {
        if (!MOCK_DB[table]) MOCK_DB[table] = [];
        const idx = MOCK_DB[table].findIndex(item => String(item.id) === String(id));
        if (idx >= 0) MOCK_DB[table][idx] = { ...data, id };
        else MOCK_DB[table].push({ ...data, id });
        saveDB();
        return true;
    },
    getNextSequentialId: (table: string, prefix: string) => {
        const items = MOCK_DB[table] || [];
        const nextId = items.length + 1;
        return `${prefix}-${nextId.toString().padStart(4, '0')}`;
    }
};

const Response_SIM = {
    success: (data: any, msg = "OK") => ({ ok: true, data, msg }),
    error: (msg: string) => ({ ok: false, msg })
};

// --- Controller Loading ---
// We'll manually specify the routes we want to handle for the Smart Order logic.
// In a real app, we'd eval the .gs files, but that's dangerous. 
// We'll just implement the logic we added to Code.gs and Expense_Controller.gs.

const Orders_Controller_SIM = {
    saveDraftOrder: (payload: any) => {
        try {
            _DB_SIM.save("DB_PENDING_ORDERS", payload.id, payload);
            return Response_SIM.success(payload);
        } catch(e: any) {
            return Response_SIM.error("Error guardando pedido: " + e.message);
        }
    },
    getPendingOrders: () => {
        try {
            const data = _DB_SIM.get("DB_PENDING_ORDERS");
            return Response_SIM.success(data || []);
        } catch(e) {
            return Response_SIM.success([]); 
        }
    }
};

const Expense_Controller_SIM = {
    saveDraftOrder: (payload: any) => {
      try {
        payload.type = 'ORDER';
        payload.status = payload.estado || 'PENDIENTE'; 
        
        if (!payload.beneficiario && payload.vendor_id) {
          const vendors = _DB_SIM.get("DB_VENDORS");
          const vendor = vendors.find((v: any) => String(v.id) === String(payload.vendor_id));
          if (vendor) payload.beneficiario = vendor.nombre_fiscal;
        }

        if (!payload.total && payload.items) {
          payload.total = payload.items.reduce((acc: number, it: any) => acc + (parseFloat(it.final_qty || 0) * parseFloat(it.unit_cost || 0)), 0);
        }

        // Simulating the save flow
        if (!payload.id || payload.id === 'new') {
            payload.id = _DB_SIM.getNextSequentialId('DB_PURCHASE_ORDERS', 'ORD');
        }
        _DB_SIM.save('DB_PURCHASE_ORDERS', payload.id, payload);
        return Response_SIM.success(payload, `Kernel Sincronizado: ${payload.id}`);
      } catch(e: any) {
        return Response_SIM.error("Error al guardar pedido de Chemin AI: " + e.message);
      }
    }
};

async function startServer() {
    app.use(express.json({ limit: '50mb' }));

    // API Route
    app.post('/api', (req, res) => {
        const { route, payload } = req.body;
        console.log(`API Call: ${route}`, payload);

        // Map routes to our simulators
        const ROUTE_MAP: Record<string, Function> = {
            'expense.save_draft_order': () => Orders_Controller_SIM.saveDraftOrder(payload),
            'expense.get_pending_orders': () => Orders_Controller_SIM.getPendingOrders(),
            'inventory.get_catalog': () => Response_SIM.success({ products: _DB_SIM.get("MASTERS") }),
            'vendor.list': () => Response_SIM.success(_DB_SIM.get("DB_VENDORS")),
            'admin.check_and_init_db': () => Response_SIM.success(null, "DB Mock Ok")
        };

        if (ROUTE_MAP[route]) {
            res.json(ROUTE_MAP[route]());
        } else {
            res.json(Response_SIM.error(`Ruta no implementada en el simulador: ${route}`));
        }
    });

    if (process.env.NODE_ENV !== 'production') {
        const vite = await createViteServer({
            server: { middlewareMode: true },
            appType: 'custom', // We'll handle index.html ourselves
        });
        
        app.use(vite.middlewares);

        app.get('*', async (req, res) => {
            try {
                let template = fs.readFileSync(path.resolve(__dirname, 'index.html'), 'utf-8');
                
                // --- GAS Template Engine Simulation ---
                const includeMatches = template.matchAll(/<\?!= include\(['"](.+?)['"]\); \?>/g);
                for (const match of includeMatches) {
                    const fileName = match[1];
                    const fullPath = path.resolve(__dirname, fileName + (fileName.endsWith('.html') ? '' : '.html'));
                    if (fs.existsSync(fullPath)) {
                        template = template.replace(match[0], fs.readFileSync(fullPath, 'utf-8'));
                    } else {
                        template = template.replace(match[0], `<!-- File not found: ${fileName} -->`);
                    }
                }
                
                // Variables like <?!= view ?>
                template = template.replace(/<\?!= view \?>/g, 'Dashboard');

                // Shim google.script.run
                const shim = `
                <script>
                window.google = {
                  script: {
                    run: {
                      withSuccessHandler: function(cb) {
                        this._success = cb;
                        return this;
                      },
                      withFailureHandler: function(cb) {
                        this._failure = cb;
                        return this;
                      },
                      api: async function(route, payload) {
                        try {
                          const res = await fetch('/api', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ route, payload })
                          });
                          const json = await res.json();
                          if (this._success) this._success(json);
                        } catch (err) {
                          if (this._failure) this._failure(err);
                        }
                      }
                    }
                  }
                };
                </script>
                `;
                template = template.replace('</head>', shim + '</head>');

                template = await vite.transformIndexHtml(req.url, template);
                res.status(200).set({ 'Content-Type': 'text/html' }).end(template);
            } catch (e: any) {
                vite.ssrFixStacktrace(e);
                res.status(500).end(e.message);
            }
        });
    }

    app.listen(PORT, '0.0.0.0', () => {
        console.log(`Titanium Server running at http://0.0.0.0:${PORT}`);
    });
}

startServer();
