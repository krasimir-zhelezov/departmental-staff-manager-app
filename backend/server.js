require('dotenv').config();
const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');

const app = express();

app.use(cors({
    origin: 'http://localhost:5500'
}));

app.use(express.json()); // Middleware to parse JSON bodies

// Create a database connection pool
const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// ==========================================
// API ROUTES
// ==========================================

// 1. Get all employees
app.get('/api/employees', async (req, res) => {
    try {
        const query = `
            SELECT 
                e.employee_id as id, 
                CONCAT(e.first_name, ' ', e.last_name) as fullName, 
                e.job_title as jobTitle, 
                e.salary,
                COALESCE(d.name, 'None') AS department,
                COALESCE(a.address_text, 'None') AS address,
                COALESCE(t.name, 'None') AS town
            FROM employees e
            LEFT JOIN departments d ON e.department_id = d.department_id
            LEFT JOIN addresses a ON e.address_id = a.address_id
            LEFT JOIN towns t ON a.town_id = t.town_id
            ORDER BY e.employee_id DESC
        `;
        const [rows] = await pool.query(query);
        res.json(rows);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

app.post('/api/employees', async (req, res) => {
    // Get a dedicated connection from the pool for the transaction
    const connection = await pool.getConnection(); 
    
    try {
        const { first_name, last_name, job_title, department_id, salary, address, town_id } = req.body;
        
        // Basic validation
        if (!first_name || !last_name || !job_title || !department_id || !salary || !address || !town_id) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        // Start the transaction
        await connection.beginTransaction();

        // 1. Insert the new address into the addresses table
        // Note: Assuming your addresses table columns are named 'address_text' and 'town_id'. 
        // Adjust 'address_text' if your actual column name is different!
        const insertAddressQuery = `
            INSERT INTO addresses (address_text, town_id) 
            VALUES (?, ?)
        `;
        const [addressResult] = await connection.query(insertAddressQuery, [address, town_id]);
        
        // 2. Get the generated address_id
        const newAddressId = addressResult.insertId;

        // 3. Insert the employee using the new address_id
        const insertEmployeeQuery = `
            INSERT INTO employees (first_name, last_name, job_title, department_id, salary, address_id) 
            VALUES (?, ?, ?, ?, ?, ?)
        `;
        const [employeeResult] = await connection.query(insertEmployeeQuery, [
            first_name, 
            last_name, 
            job_title, 
            department_id, 
            salary, 
            newAddressId
        ]);

        // Commit the transaction if both queries succeed
        await connection.commit();

        res.status(201).json({ message: 'Employee and Address created', id: employeeResult.insertId });
    } catch (error) {
        // If anything fails, undo the address insertion
        await connection.rollback();
        console.error(error);
        res.status(500).json({ error: 'Internal Server Error' });
    } finally {
        // Always release the connection back to the pool
        connection.release();
    }
});

// 2. Get a specific employee with their Department and Address details (Using JOINs based on your FKs)
app.get('/api/employees/:id', async (req, res) => {
    try {
        const employeeId = req.params.id;
        const query = `
            SELECT 
                e.employee_id, e.first_name, e.last_name, e.job_title, e.salary,
                d.name AS department_name,
                a.address_text,
                t.name AS town_name
            FROM employees e
            LEFT JOIN departments d ON e.department_id = d.department_id
            LEFT JOIN addresses a ON e.address_id = a.address_id
            LEFT JOIN towns t ON a.town_id = t.town_id
            WHERE e.employee_id = ?
        `;
        const [rows] = await pool.query(query, [employeeId]);
        
        if (rows.length === 0) {
            return res.status(404).json({ error: 'Employee not found' });
        }
        res.json(rows[0]);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// 3. Get all projects for a specific employee (Using the employees_projects mapping table)
app.get('/api/employees/:id/projects', async (req, res) => {
    try {
        const employeeId = req.params.id;
        const query = `
            SELECT p.project_id, p.name, p.description, p.start_date, p.end_date
            FROM projects p
            JOIN employees_projects ep ON p.project_id = ep.project_id
            WHERE ep.employee_id = ?
        `;
        const [rows] = await pool.query(query, [employeeId]);
        res.json(rows);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// 4. Get all departments
app.get('/api/departments', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM departments');
        res.json(rows);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

app.get('/api/towns', async (req, res) => {
    try {
        // Fetching towns and ordering them alphabetically for a better UX
        const [rows] = await pool.query('SELECT town_id, name FROM towns ORDER BY name ASC');
        res.json(rows);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// 5. Create a new department (POST request example)
app.post('/api/departments', async (req, res) => {
    try {
        const { name, manager_id } = req.body;
        
        if (!name || !manager_id) {
            return res.status(400).json({ error: 'Name and manager_id are required' });
        }

        const query = 'INSERT INTO departments (name, manager_id) VALUES (?, ?)';
        const [result] = await pool.query(query, [name, manager_id]);
        
        res.status(201).json({ 
            message: 'Department created successfully', 
            department_id: result.insertId 
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// ==========================================
// START SERVER
// ==========================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});