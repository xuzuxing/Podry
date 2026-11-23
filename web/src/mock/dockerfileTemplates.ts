import type { DockerfileTemplateContent } from '@/types/dockerfile'

/** 离线编辑示例，不代表上游实时目录或已经执行验证的项目构建方案。 */
export const dockerfileTemplates: DockerfileTemplateContent[] = [
  {
    id: 'node-basic', language: 'Node.js', framework: 'Node.js',
    content: 'FROM node:22-alpine\nWORKDIR /app\nCOPY package*.json ./\nRUN npm ci --omit=dev\nCOPY . .\nEXPOSE 3000\nCMD ["npm", "start"]\n',
  },
  {
    id: 'node-express', language: 'Node.js', framework: 'Express',
    content: '# Express application\nFROM node:22-alpine\nENV NODE_ENV=production\nWORKDIR /app\nCOPY package*.json ./\nRUN npm ci --omit=dev\nCOPY . .\nEXPOSE 3000\nUSER node\nCMD ["node", "server.js"]\n',
  },
  {
    id: 'node-next', language: 'Node.js', framework: 'Next.js',
    content: '# Requires output: standalone in next.config\nFROM node:22-alpine AS build\nWORKDIR /app\nCOPY package*.json ./\nRUN npm ci\nCOPY . .\nRUN npm run build\nFROM node:22-alpine\nWORKDIR /app\nENV NODE_ENV=production\nCOPY --from=build /app/.next/standalone ./\nCOPY --from=build /app/.next/static ./.next/static\nCOPY --from=build /app/public ./public\nEXPOSE 3000\nUSER node\nCMD ["node", "server.js"]\n',
  },
  {
    id: 'go-basic', language: 'Go', framework: 'Go',
    content: 'FROM golang:1.24-alpine AS build\nWORKDIR /src\nCOPY . .\nRUN go build -o /app/server .\nFROM alpine:3.21\nCOPY --from=build /app/server /server\nENTRYPOINT ["/server"]\n',
  },
  {
    id: 'python-basic', language: 'Python', framework: 'Python',
    content: 'FROM python:3.12-slim\nWORKDIR /app\nCOPY requirements.txt .\nRUN pip install --no-cache-dir -r requirements.txt\nCOPY . .\nCMD ["python", "app.py"]\n',
  },
  {
    id: 'python-fastapi', language: 'Python', framework: 'FastAPI',
    content: 'FROM python:3.12-slim\nWORKDIR /app\nCOPY requirements.txt .\nRUN pip install --no-cache-dir -r requirements.txt\nCOPY . .\nEXPOSE 8000\nCMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]\n',
  },
  {
    id: 'java-spring', language: 'Java', framework: 'Spring Boot',
    content: 'FROM maven:3.9-eclipse-temurin-21 AS build\nWORKDIR /app\nCOPY pom.xml .\nCOPY src ./src\nRUN mvn -B package -DskipTests\nFROM eclipse-temurin:21-jre\nWORKDIR /app\nCOPY --from=build /app/target/*.jar app.jar\nEXPOSE 8080\nENTRYPOINT ["java", "-jar", "/app/app.jar"]\n',
  },
  {
    id: 'static-nginx', language: 'HTML', framework: 'Nginx',
    content: 'FROM nginx:1.28-alpine\nCOPY . /usr/share/nginx/html\nEXPOSE 80\nCMD ["nginx", "-g", "daemon off;"]\n',
  },
]
