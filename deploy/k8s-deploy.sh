#!/bin/bash
# Deploy CityLens to the team namespace without a container registry:
# public python image + code from ConfigMaps + credentials from a Secret + Ingress at /app.
set -euo pipefail
cd "$(dirname "$0")/.."
NS="${NS:-$USERNAME}"
TEAM_N="${NS#team-}"
APP_HOST="video-lab-team-${TEAM_N}.cosmos.vastdata.com"
APP=citylens
PORT=8080
# Inside the cluster the video backend is a plain Service; the lab hostname in INGRESS_URL only resolves on the VM.
VSS_URL_INCLUSTER="${VSS_URL_INCLUSTER:-http://video-backend-service:8000}"

kubectl -n "$NS" create configmap ${APP}-app --from-file=app/ --dry-run=client -o yaml | kubectl apply -f -
kubectl -n "$NS" create configmap ${APP}-static --from-file=app/static/ --dry-run=client -o yaml | kubectl apply -f -
kubectl -n "$NS" create configmap ${APP}-root --from-file=requirements.txt --dry-run=client -o yaml | kubectl apply -f -
kubectl -n "$NS" create secret generic ${APP}-env \
  --from-literal=VSS_URL="$VSS_URL_INCLUSTER" --from-literal=VSS_USERNAME="$USERNAME" --from-literal=VSS_PASSWORD="$PASSWORD" \
  --from-literal=WANDB_API_KEY="$WANDB_API_KEY" --from-literal=WANDB_TEAM="$WANDB_TEAM" --from-literal=WANDB_PROJECT="$WANDB_PROJECT" \
  --from-literal=GPU_BEARER_TOKEN="$GPU_BEARER_TOKEN" \
  --from-literal=S3_ENDPOINT="$S3_ENDPOINT" --from-literal=ACCESS_KEY="$ACCESS_KEY" --from-literal=SECRET_KEY="$SECRET_KEY" \
  --from-literal=VASTDB_BUCKET="$VASTDB_BUCKET" --from-literal=VDB_SCHEMA="${VDB_SCHEMA:-vss-schema}" --from-literal=VDB_COLLECTION="${VDB_COLLECTION:-vss-collection}" \
  --dry-run=client -o yaml | kubectl apply -f -

kubectl -n "$NS" apply -f - <<YAML
apiVersion: apps/v1
kind: Deployment
metadata: {name: ${APP}, labels: {app: ${APP}}}
spec:
  replicas: 1
  selector: {matchLabels: {app: ${APP}}}
  template:
    metadata: {labels: {app: ${APP}}}
    spec:
      containers:
      - name: app
        image: python:3.12-slim
        imagePullPolicy: IfNotPresent
        ports: [{containerPort: ${PORT}}]
        env:
        - {name: PORT, value: "${PORT}"}
        - {name: STATIC_DIR, value: /code/static}
        - {name: PYTHONUNBUFFERED, value: "1"}
        envFrom: [{secretRef: {name: ${APP}-env}}]
        volumeMounts:
        - {name: app, mountPath: /code/app}
        - {name: static, mountPath: /code/static}
        - {name: root, mountPath: /code/requirements.txt, subPath: requirements.txt}
        workingDir: /code
        command: ["bash", "-c"]
        args:
        - |
          set -euo pipefail
          pip install --no-cache-dir -q -r requirements.txt
          exec python app/main.py
        readinessProbe:
          httpGet: {path: /health, port: ${PORT}}
          initialDelaySeconds: 15
          periodSeconds: 10
          failureThreshold: 40
        resources:
          requests: {cpu: "250m", memory: "512Mi"}
          limits: {memory: "2Gi"}
      volumes:
      - {name: app, configMap: {name: ${APP}-app}}
      - {name: static, configMap: {name: ${APP}-static}}
      - {name: root, configMap: {name: ${APP}-root}}
---
apiVersion: v1
kind: Service
metadata: {name: ${APP}, labels: {app: ${APP}}}
spec:
  selector: {app: ${APP}}
  ports: [{name: http, port: 80, targetPort: ${PORT}}]
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: ${APP}
  labels: {app: ${APP}}
  annotations: {nginx.ingress.kubernetes.io/rewrite-target: /\$2, nginx.ingress.kubernetes.io/proxy-read-timeout: "300", nginx.ingress.kubernetes.io/proxy-body-size: "50m"}
spec:
  ingressClassName: nginx
  rules:
  - host: ${APP_HOST}
    http:
      paths:
      - path: /app(/|$)(.*)
        pathType: ImplementationSpecific
        backend: {service: {name: ${APP}, port: {number: 80}}}
YAML
kubectl -n "$NS" rollout restart deploy/${APP} >/dev/null 2>&1 || true
echo "Deployed. Waiting for the pod..."
kubectl -n "$NS" rollout status deploy/${APP} --timeout=420s
kubectl -n "$NS" get pods,ingress -l app=${APP}
curl -sS -o /dev/null -w "ingress /app -> %{http_code}\n" "http://${APP_HOST}/app"
curl -sS "http://${APP_HOST}/app/health"; echo
