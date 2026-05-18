# Budget Tracker

A personal budget tracking app with multi-plan support, monthly periods, and category-level budget tracking.

## Structure

```
budget-tracker/
├── frontend/
│   ├── index.html
│   ├── style.css
│   └── script.js
└── backend/
    ├── server.js
    ├── vercel.json
    ├── package.json
    └── models/
        ├── Plan.js
        ├── Period.js
        └── Expense.js
```

## Data Model

- **Plan** — a budget configuration with a monthly income and a set of spending categories
- **Period** — a time window within a plan (monthly, weekly, yearly, or custom dates)
- **Expense** — a transaction logged against a specific period

## Running Locally

**Backend**

```bash
cd backend
cp .env.example .env        # add your MongoDB Atlas URI
npm install
node server.js
```

**Frontend**

Open `frontend/index.html` directly in a browser. The API URL in `script.js` defaults to `http://localhost:5000`.

## Deploying

**Backend (Vercel)**

1. Push the `backend/` folder to a GitHub repository
2. Import the repo in Vercel, set root directory to `backend`
3. Add the environment variable `MONGO_URI` in Vercel project settings
4. After deploy, copy the Vercel URL

**Frontend (GitHub Pages)**

1. Push the `frontend/` folder to a GitHub repository
2. Enable GitHub Pages in repo settings (source: main branch)
3. In `frontend/script.js`, replace the API constant:

```js
const API = "https://your-app.vercel.app";
```

## Environment Variables

| Variable    | Description                     |
| ----------- | ------------------------------- |
| `MONGO_URI` | MongoDB Atlas connection string |
| `PORT`      | Server port, defaults to 5000   |

## API Reference

| Method | Route                       | Description                          |
| ------ | --------------------------- | ------------------------------------ |
| GET    | /plans                      | List all plans                       |
| POST   | /plans                      | Create a plan                        |
| PUT    | /plans/:id                  | Update plan name, salary, categories |
| DELETE | /plans/:id                  | Delete plan and all its data         |
| GET    | /plans/:planId/periods      | List periods for a plan              |
| POST   | /plans/:planId/periods      | Create a period                      |
| DELETE | /periods/:id                | Delete period and its expenses       |
| GET    | /periods/:periodId/expenses | List expenses for a period           |
| POST   | /periods/:periodId/expenses | Add an expense                       |
| DELETE | /expenses/:id               | Delete an expense                    |
