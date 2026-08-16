# Deploy TerraCORE Prototype ด้วย Argo CD และ Cloudflare Tunnel

คู่มือนี้ตั้งค่าให้เปิดแอปที่ **https://terracore.denmannsolutions.com** โดยใช้
Cloudflare Tunnel ตัวเดิมใน k3s และไม่เปิดพอร์ตจากอินเทอร์เน็ตเข้าหาเครื่องโดยตรง
เลือกใช้ subdomain `terracore` เพื่อไม่แย่ง route ของเว็บไซต์ที่ apex
`denmannsolutions.com`; ถ้าต้องการใช้ apex จริงให้เว้น Subdomain ในขั้นตอน Cloudflare
และตรวจว่า apex ไม่มี route เดิมที่ยังใช้งานอยู่ก่อน

## Quick deploy

เมื่อ cluster มี Argo CD ใน namespace `argocd` แล้ว ใช้ manifest จาก Public GitHub
repository ได้โดยตรง:

```bash
kubectl apply -f https://raw.githubusercontent.com/TxngJr/TerraCorePrototype/main/deploy/argocd/application.yaml
kubectl -n argocd get application terracore-prototype
```

Application จะอ่าน `main/deploy/k8s`, สร้าง namespace `terracore-prototype` และ deploy
public image จาก GHCR ให้อัตโนมัติ จากนั้นจึงทำหัวข้อ Cloudflare route เพื่อเปิดโดเมน

## ภาพรวม

```text
Browser
  -> Cloudflare DNS / HTTPS / WAF
  -> Cloudflare Tunnel: minipc-ecenoww-k3s
  -> http://terracore.terracore-prototype.svc.cluster.local:80
  -> Service/terracore (ClusterIP)
  -> Pod/terracore:8000
  -> /data/terracore.db บน PVC 1 GiB
```

ชุด deploy ตั้งใจสำหรับ prototype:

- แอปรัน 1 replica ด้วย Gunicorn เพราะ SQLite ไม่รองรับการเขียนพร้อมกันจากหลาย Pod ได้ดี
- ใช้ Deployment strategy แบบ `Recreate` ป้องกัน Pod เก่าและใหม่เปิดไฟล์ SQLite พร้อมกัน
- ข้อมูลอยู่ใน PVC ชื่อ `terracore-data`; การ deploy image ใหม่ไม่ลบฐานข้อมูล
- PVC มี `Prune=false,Delete=false`; การลบ Argo Application จะไม่ลบฐานข้อมูลตามไปด้วย
- Container รันเป็น non-root, root filesystem เป็น read-only และมี CPU/RAM limits
- Argo CD เปิด auto-sync, prune และ self-heal
- Cloudflare Tunnel ต่อเข้า ClusterIP โดยตรง จึงไม่ต้องสร้าง Ingress หรือ NodePort

## 0. สิ่งที่ต้องมี

1. k3s cluster ใช้งานได้ และ `kubectl get nodes` แสดงสถานะ `Ready`
2. Argo CD อยู่ใน namespace `argocd` ตามระบบในภาพตัวอย่าง
3. `cloudflared` ของ tunnel `minipc-ecenoww-k3s` ทำงานอยู่ใน cluster และ resolve ชื่อ
   `*.svc.cluster.local` ได้
4. zone `denmannsolutions.com` ถูกเพิ่มและ Active ใน Cloudflare account เดียวกัน
5. Git repository ที่ Argo CD อ่านได้ และ GitHub Actions เปิดใช้งาน
6. GHCR package ต้องเป็น Public สำหรับขั้นตอนแบบง่ายนี้ ถ้าจะใช้ Private ให้อ่านหัวข้อท้ายคู่มือ

ตรวจ cluster และ tunnel ก่อน:

```bash
kubectl get nodes
kubectl get pods -A | grep -E 'argocd|cloudflared'
```

## 1. GitHub repository

ไฟล์ทั้งหมดตั้งค่าไว้กับ Public repository นี้แล้ว:

```text
https://github.com/TxngJr/TerraCorePrototype
```

Argo CD ใช้ branch `main`, path `deploy/k8s` และ image
`ghcr.io/txngjr/terracore-prototype` โดยตรง ไม่ต้องแก้ placeholder หรือรันสคริปต์ตั้งค่า

## 2. Build image ด้วย GitHub Actions

workflow `.github/workflows/build-image.yaml` จะทำงานเมื่อ push เข้า `main`:

1. build `Dockerfile`
2. push image สอง tag ไป GHCR ได้แก่ `prototype` และ `sha-<commit>`
3. เขียน immutable tag `sha-<commit>` กลับลง `deploy/k8s/kustomization.yaml`
4. commit manifest กลับเข้า `main` เพื่อให้ Argo CD เห็น desired state ใหม่

ตั้งค่าที่ GitHub repository:

1. เปิด **Settings > Actions > General**
2. ใน **Workflow permissions** เลือก **Read and write permissions**
3. เปิดหน้า **Actions** และรอ job `Build and publish prototype image` ผ่าน
4. เปิด package `terracore-prototype` แล้วเปลี่ยน **Package visibility** เป็น **Public**

ตรวจว่าหลัง workflow จบ `newTag` เปลี่ยนเป็น immutable tag:

```bash
git pull --ff-only
grep -A3 '^images:' deploy/k8s/kustomization.yaml
```

ถ้า branch protection ไม่อนุญาตให้ bot push ให้แก้ tag เองแล้ว commit:

```bash
sed -i 's/newTag: .*/newTag: sha-<7_DIGIT_COMMIT>/' deploy/k8s/kustomization.yaml
git add deploy/k8s/kustomization.yaml
git commit -m "chore(deploy): update TerraCORE image"
git push
```

## 3. ให้ Argo CD อ่าน repository

ถ้า repository เป็น Public ข้ามการเพิ่ม credential ได้ ถ้าเป็น Private:

1. เปิด Argo CD
2. ไปที่ **Settings > Repositories > Connect Repo**
3. เลือก HTTPS หรือ SSH และกรอก credential แบบ read-only
4. ต้องเห็น Connection Status เป็น `Successful`

จากเครื่องที่มีสิทธิ์เข้าถึง cluster ให้สร้าง Application:

```bash
kubectl apply -f deploy/argocd/application.yaml
kubectl -n argocd get application terracore-prototype
```

หรือสร้างจากหน้า Argo CD ด้วยค่าเดียวกัน:

| ช่อง | ค่า |
|---|---|
| Application Name | `terracore-prototype` |
| Project | `default` |
| Sync Policy | `Automatic`, เปิด Prune และ Self Heal |
| Repository URL | `https://github.com/TxngJr/TerraCorePrototype.git` |
| Revision | `refs/heads/main` |
| Path | `deploy/k8s` |
| Cluster URL | `https://kubernetes.default.svc` |
| Namespace | `terracore-prototype` |

รอจนสถานะเป็น `Healthy` และ `Synced` แล้วตรวจ workload:

```bash
kubectl -n terracore-prototype get deploy,pod,svc,pvc
kubectl -n terracore-prototype rollout status deploy/terracore --timeout=180s
kubectl -n terracore-prototype logs deploy/terracore --tail=100
```

ทดสอบจากใน cluster ก่อนต่อ Cloudflare:

```bash
kubectl -n terracore-prototype port-forward svc/terracore 8080:80
```

จากนั้นเปิด http://127.0.0.1:8080 และ http://127.0.0.1:8080/healthz

## 4. เพิ่ม Published application route ใน Cloudflare

ใช้ tunnel เดิมตามภาพ ไม่ต้องสร้าง tunnel ซ้ำ:

1. เข้า Cloudflare Dashboard
2. ไปที่ **Networking > Tunnels** แล้วเลือก `minipc-ecenoww-k3s`
3. เปิดแท็บ **Published application routes**
4. กด **Add a published application route**
5. กรอกค่า:

| ช่อง | ค่า |
|---|---|
| Subdomain | `terracore` |
| Domain | `denmannsolutions.com` |
| Path | เว้นว่าง |
| Service type | `HTTP` |
| Service URL | `terracore.terracore-prototype.svc.cluster.local:80` |

ถ้าหน้าจอให้กรอก URL ช่องเดียว ให้ใส่:

```text
http://terracore.terracore-prototype.svc.cluster.local:80
```

6. ไม่ต้องเปิด `No TLS Verify` เพราะ origin เป็น HTTP ภายใน cluster
7. กด Save และให้ route นี้อยู่เหนือ catch-all `http_status:404`

Cloudflare จะสร้าง DNS record ของ `terracore.denmannsolutions.com` ให้ tunnel อัตโนมัติ
ไม่ต้องสร้าง A record ไปยัง public IP ของบ้านหรือเครื่อง k3s

## 5. ตรวจจากภายนอก

```bash
curl -fsS https://terracore.denmannsolutions.com/healthz
curl -I https://terracore.denmannsolutions.com/
```

ผล health check ที่ถูกต้องคือ:

```json
{"status":"ok"}
```

ตรวจทั้ง chain เมื่อมีปัญหา:

```bash
# 1) ตัวแอปและ PVC
kubectl -n terracore-prototype get pod,svc,pvc

# 2) endpoint ที่ Service เลือกได้
kubectl -n terracore-prototype get endpoints terracore

# 3) log แอป
kubectl -n terracore-prototype logs deploy/terracore --tail=200

# 4) log tunnel (เปลี่ยน namespace/name ให้ตรง cluster)
kubectl get deploy -A | grep cloudflared
kubectl -n <CLOUDFLARED_NAMESPACE> logs deploy/<CLOUDFLARED_DEPLOYMENT> --tail=200
```

อาการที่พบบ่อย:

| อาการ | ตรวจ/แก้ |
|---|---|
| Argo CD เป็น `ImagePullBackOff` | GHCR package ยัง Private หรือชื่อ owner/image ผิด |
| PVC เป็น `Pending` | cluster ไม่มี default StorageClass; k3s ปกติใช้ `local-path` |
| Cloudflare Error 1033 | connector ของ tunnel Offline |
| Cloudflare 502 | Service URL ผิด หรือ cloudflared resolve/reach ClusterIP ไม่ได้ |
| ได้ 404 ของ tunnel | route อยู่หลัง catch-all หรือ hostname ไม่ตรง |
| Argo CD เป็น `ComparisonError` | repo URL/credential/path/branch ไม่ถูกต้อง |

## 6. การ deploy รุ่นถัดไปและ rollback

ทุกครั้งที่ push code เข้า `main`, workflow จะ build image ด้วย immutable tag ใหม่และ commit tag
กลับเข้า Git จากนั้น Argo CD จะ sync ให้อัตโนมัติ ตรวจสถานะด้วย:

```bash
kubectl -n terracore-prototype rollout status deploy/terracore
kubectl -n terracore-prototype get pod -w
```

การ rollback แบบ GitOps ให้ revert commit ที่เปลี่ยน `newTag` แล้ว push:

```bash
git log --oneline -- deploy/k8s/kustomization.yaml
git revert <BAD_DEPLOY_COMMIT>
git push
```

Argo CD จะนำ tag ก่อนหน้ากลับมาเอง อย่า rollback Deployment ด้วย `kubectl rollout undo`
เพราะ self-heal จะปรับกลับไปตาม Git

## 7. สำรอง SQLite

ก่อนเปลี่ยนแปลงสำคัญให้สำรองไฟล์ฐานข้อมูลออกจาก Pod:

```bash
pod=$(kubectl -n terracore-prototype get pod -l app.kubernetes.io/name=terracore -o jsonpath='{.items[0].metadata.name}')
kubectl -n terracore-prototype exec "$pod" -- python -c \
  'import sqlite3; src=sqlite3.connect("/data/terracore.db"); dst=sqlite3.connect("/tmp/terracore-backup.db"); src.backup(dst); dst.close(); src.close()'
kubectl -n terracore-prototype cp "$pod:/tmp/terracore-backup.db" "./terracore-backup-$(date +%F).db"
```

ไฟล์ backup มีข้อมูลผู้ใช้ทั้งหมด อย่า commit เข้า Git

ถ้าต้องการลบข้อมูล prototype จริง ต้องสั่งโดยตั้งใจ (ย้อนกลับไม่ได้ถ้าไม่มี backup):

```bash
kubectl -n terracore-prototype delete pvc terracore-data
```

## 8. ถ้า GHCR ต้องเป็น Private

สร้าง pull secret ใน namespace ปลายทางโดยใช้ GitHub PAT ที่มีสิทธิ์ `read:packages`:

```bash
kubectl create namespace terracore-prototype --dry-run=client -o yaml | kubectl apply -f -
kubectl -n terracore-prototype create secret docker-registry ghcr-pull-secret \
  --docker-server=ghcr.io \
  --docker-username='<GITHUB_USER>' \
  --docker-password='<GITHUB_PAT>'
```

จากนั้นเพิ่มใน `spec.template.spec` ของ `deploy/k8s/deployment.yaml`, commit และ push:

```yaml
imagePullSecrets:
  - name: ghcr-pull-secret
```

อย่าเก็บ PAT หรือ tunnel token เป็นไฟล์ YAML ใน Git สำหรับ prototype นี้ Argo CD จัดการเฉพาะ
แอป ส่วน connector/tunnel token ใช้ของเดิมที่ติดตั้งอยู่แล้ว

## ไฟล์ที่เกี่ยวข้อง

```text
Dockerfile                              image สำหรับ production-like prototype
.dockerignore                           ลด build context และกัน DB หลุดเข้า image
.github/workflows/build-image.yaml      build/push GHCR และอัปเดต immutable image tag
deploy/argocd/application.yaml          Argo CD Application
deploy/k8s/kustomization.yaml           Kustomize entry point และ image tag
deploy/k8s/deployment.yaml              Flask/Gunicorn workload
deploy/k8s/service.yaml                 ClusterIP สำหรับ Cloudflare Tunnel
deploy/k8s/persistent-volume-claim.yaml SQLite storage
```

เอกสารอ้างอิงหลัก:

- [Cloudflare Tunnel บน Kubernetes](https://developers.cloudflare.com/tunnel/deployment-guides/kubernetes/)
- [Cloudflare Published applications](https://developers.cloudflare.com/tunnel/routing/)
- [Argo CD automated sync](https://argo-cd.readthedocs.io/en/stable/user-guide/auto_sync/)
- [GitHub Container Registry](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry)
