# Rota Instrumentação · Transpetro 2026

App de estudos para o concurso Transpetro 2026 — Técnico de Nível Médio, Ênfase 10: Manutenção – Instrumentação (prova em 06/12/2026).

## O que tem
- Café de 10 minutos: revisão rápida com treino de leitura do enunciado ("o que a banca está cobrando?").
- 75 questões: 69 originais das provas Transpetro 2008 e 2023 e Petrobras 2011, 2012 e 2018, com gabarito oficial conferido, e 6 marcadas como QUESTÃO SIMULADA — ESTILO CESGRANRIO.
- Explicação em 4 partes, caderno de erros, simulados cronometrados, calendário de 11/11 a 06/12, caderno de fórmulas e análise das 275 questões das 5 provas.

## Como usar
Abra `index.html` no navegador. O progresso fica salvo no navegador (localStorage); use Mais › Backup para exportar e importar.

## Como editar
O conteúdo fica em `src/`:
- `bank.js` — banco de questões (para acrescentar, copie um bloco e preencha os campos)
- `content.js` — calendário, fórmulas e guia da banca
- `analise.js` — classificação das 275 questões
- `app.js` — lógica do app

Depois de editar, rode `python3 build.py` para gerar o `index.html`.
