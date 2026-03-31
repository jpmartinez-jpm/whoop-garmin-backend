# WHOOP × Garmin — Backend

Backend que maneja el OAuth con Whoop y sirve los datos al widget del reloj.

## Cómo funciona

```
1. Widget muestra código "WG-XXXX"
2. Usuario abre https://TU-APP.railway.app/connect?code=WG-XXXX en el teléfono
3. Hace login con su cuenta de Whoop
4. Widget detecta que el pairing se completó y empieza a mostrar datos
5. El backend sincroniza los datos cada 30 minutos automáticamente
```

## Deploy en Railway (gratis)

### 1. Prerequisitos
- Cuenta en [railway.app](https://railway.app) (gratis)
- Credenciales de Whoop (de [developer.whoop.com](https://developer.whoop.com))
- Este código en un repositorio de GitHub

### 2. Crear el proyecto en Railway

```bash
# Opción A: desde la CLI
npm install -g @railway/cli
railway login
railway init
railway up

# Opción B: desde railway.app
# → New Project → Deploy from GitHub → seleccioná el repo
```

### 3. Agregar un volumen para la DB

En Railway → tu proyecto → Add Service → Volume
- Mount path: `/data`
- Esto persiste la DB entre deploys

### 4. Variables de entorno

En Railway → tu proyecto → Variables, agregar:

```
WHOOP_CLIENT_ID      = (de developer.whoop.com)
WHOOP_CLIENT_SECRET  = (de developer.whoop.com)
WHOOP_REDIRECT_URI   = https://TU-APP.up.railway.app/oauth/callback
DB_PATH              = /data/whoop.db
```

### 5. Configurar la Redirect URI en Whoop

En el dashboard de Whoop Developer, agregar como Redirect URI:
```
https://TU-APP.up.railway.app/oauth/callback
```

### 6. Actualizar la URL en el widget

En `WhoopWidget.mc`, reemplazar:
```
const BACKEND_URL = "https://TU-APP.up.railway.app";
```

## Endpoints

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/health` | Health check |
| POST | `/pair/init` | Widget pide un código de pairing |
| GET | `/pair/status/:code` | Widget consulta si el pairing se completó |
| GET | `/connect?code=XX` | Página de inicio del OAuth (usuario) |
| GET | `/oauth/callback` | Callback de Whoop OAuth |
| GET | `/data/:code` | Widget pide los datos actualizados |

## Desarrollo local

```bash
cp .env.example .env
# Completar .env con tus credenciales

npm install
mkdir -p db
npm run dev
```

El servidor queda en `http://localhost:3000`.

Para testear el flujo de pairing localmente podés usar [ngrok](https://ngrok.com):
```bash
ngrok http 3000
# Copiar la URL https://xxxx.ngrok.io como WHOOP_REDIRECT_URI
```
