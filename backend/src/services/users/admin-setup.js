const bcrypt = require('bcryptjs');
const pool = require('../../config/database');

const VALID_ROLES = [
  'COURSE_MANAGER',
  'AGENT',
  'DEPARTMENT_MANAGER',
  'EMPLOYEE',
];

function parseRoles(rolesText) {
  return rolesText ? rolesText.split(',') : [];
}

function toNumber(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function createDepartmentCode() {
  return `DEPT-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

async function getRoleId(connection, roleCode) {
  const [rows] = await connection.execute(
    'SELECT id FROM roles WHERE code = ?',
    [roleCode]
  );

  return rows[0]?.id || null;
}

async function fetchUserById(connection, userId) {
  const [rows] = await connection.execute(
    `
      SELECT
        u.id,
        u.username,
        u.is_active,
        u.deleted_at,

        up.full_name,
        up.employee_number,

        GROUP_CONCAT(DISTINCT r.code ORDER BY r.code) AS roles_text,

        MAX(agent_sector.id) AS sector_id,
        MAX(agent_sector.name) AS sector_name,

        MAX(manager_agent.agent_user_id) AS agent_user_id,
        MAX(manager_department.id) AS department_id,
        MAX(manager_department.name) AS department_name,

        MAX(employee_manager.manager_user_id) AS manager_user_id,
        MAX(employee_manager_profile.full_name) AS department_manager_name

      FROM users u
      LEFT JOIN user_profiles up
        ON up.user_id = u.id

      LEFT JOIN user_roles ur
        ON ur.user_id = u.id

      LEFT JOIN roles r
        ON r.id = ur.role_id

      LEFT JOIN sector_agent_assignments own_agent_assignment
        ON own_agent_assignment.agent_user_id = u.id
        AND own_agent_assignment.end_date IS NULL

      LEFT JOIN sectors agent_sector
        ON agent_sector.id = own_agent_assignment.sector_id

      LEFT JOIN department_manager_assignments own_manager_assignment
        ON own_manager_assignment.manager_user_id = u.id
        AND own_manager_assignment.end_date IS NULL

      LEFT JOIN departments manager_department
        ON manager_department.id = own_manager_assignment.department_id

      LEFT JOIN sector_agent_assignments manager_agent
        ON manager_agent.id = own_manager_assignment.agent_assignment_id

      LEFT JOIN employee_department_assignments employee_assignment
        ON employee_assignment.employee_user_id = u.id
        AND employee_assignment.end_date IS NULL

      LEFT JOIN department_manager_assignments employee_manager
        ON employee_manager.id = employee_assignment.manager_assignment_id

      LEFT JOIN user_profiles employee_manager_profile
        ON employee_manager_profile.user_id = employee_manager.manager_user_id

      WHERE u.id = ?
        AND u.deleted_at IS NULL

      GROUP BY
        u.id,
        u.username,
        u.is_active,
        u.deleted_at,
        up.full_name,
        up.employee_number
    `,
    [userId]
  );

  if (!rows.length) return null;

  return {
    ...rows[0],
    roles: parseRoles(rows[0].roles_text),
  };
}

async function writeAuditLog(connection, actorUserId, eventType, entityId, afterData) {
  await connection.execute(
    `
      INSERT INTO audit_logs (
        actor_user_id,
        event_type,
        entity_type,
        entity_id,
        after_data
      )
      VALUES (?, ?, 'users', ?, ?)
    `,
    [
      actorUserId,
      eventType,
      entityId,
      JSON.stringify(afterData),
    ]
  );
}

async function assignAgent(connection, userId, sectorName, actorUserId) {
  const normalizedSectorName = sectorName.trim();

  const [sectorRows] = await connection.execute(
    `
      SELECT id
      FROM sectors
      WHERE name = ?
        AND deleted_at IS NULL
      LIMIT 1
    `,
    [normalizedSectorName]
  );

  let sectorId = sectorRows[0]?.id;

  // إذا القطاع غير موجود، ينشأ تلقائيًا.
  if (!sectorId) {
    const [newSector] = await connection.execute(
      `
        INSERT INTO sectors (
          code,
          name
        )
        VALUES (?, ?)
      `,
      [
        `SECTOR-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
        normalizedSectorName,
      ]
    );

    sectorId = newSector.insertId;
  }

  const [currentRows] = await connection.execute(
    `
      SELECT id, sector_id
      FROM sector_agent_assignments
      WHERE agent_user_id = ?
        AND end_date IS NULL
    `,
    [userId]
  );

  if (currentRows[0]?.sector_id === sectorId) {
    return;
  }

  // إنهاء تعيين الوكيل القديم، إن وجد.
  await connection.execute(
    `
      UPDATE sector_agent_assignments
      SET end_date = CURDATE()
      WHERE agent_user_id = ?
        AND end_date IS NULL
    `,
    [userId]
  );

  // القطاع له وكيل نشط واحد.
  await connection.execute(
    `
      UPDATE sector_agent_assignments
      SET end_date = CURDATE()
      WHERE sector_id = ?
        AND end_date IS NULL
    `,
    [sectorId]
  );

  await connection.execute(
    `
      INSERT INTO sector_agent_assignments (
        sector_id,
        agent_user_id,
        start_date,
        created_by_user_id
      )
      VALUES (?, ?, CURDATE(), ?)
    `,
    [sectorId, userId, actorUserId]
  );
}
async function assignDepartmentManager(
  connection,
  userId,
  agentUserId,
  departmentName,
  actorUserId
) {
  const [agentRows] = await connection.execute(
    `
      SELECT
        saa.id AS agent_assignment_id,
        saa.sector_id
      FROM sector_agent_assignments saa
      JOIN users u ON u.id = saa.agent_user_id
      WHERE saa.agent_user_id = ?
        AND saa.end_date IS NULL
        AND u.is_active = TRUE
        AND u.deleted_at IS NULL
    `,
    [agentUserId]
  );

  if (!agentRows.length) {
    throw new Error('الوكيل المحدد غير نشط أو غير مرتبط بقطاع.');
  }

  const { agent_assignment_id, sector_id } = agentRows[0];

  const [departmentRows] = await connection.execute(
    `
      SELECT id
      FROM departments
      WHERE sector_id = ?
        AND name = ?
        AND deleted_at IS NULL
      LIMIT 1
    `,
    [sector_id, departmentName]
  );

  let departmentId = departmentRows[0]?.id;

  if (!departmentId) {
    const [result] = await connection.execute(
      `
        INSERT INTO departments (
          sector_id,
          code,
          name
        )
        VALUES (?, ?, ?)
      `,
      [sector_id, createDepartmentCode(), departmentName]
    );

    departmentId = result.insertId;
  }

  const [currentRows] = await connection.execute(
    `
      SELECT department_id, agent_assignment_id
      FROM department_manager_assignments
      WHERE manager_user_id = ?
        AND end_date IS NULL
    `,
    [userId]
  );

  if (
    currentRows[0]?.department_id === departmentId &&
    currentRows[0]?.agent_assignment_id === agent_assignment_id
  ) {
    return;
  }

  await connection.execute(
    `
      UPDATE department_manager_assignments
      SET end_date = CURDATE()
      WHERE manager_user_id = ?
        AND end_date IS NULL
    `,
    [userId]
  );

  await connection.execute(
    `
      UPDATE department_manager_assignments
      SET end_date = CURDATE()
      WHERE department_id = ?
        AND end_date IS NULL
    `,
    [departmentId]
  );

  await connection.execute(
    `
      INSERT INTO department_manager_assignments (
        department_id,
        manager_user_id,
        agent_assignment_id,
        start_date,
        created_by_user_id
      )
      VALUES (?, ?, ?, CURDATE(), ?)
    `,
    [departmentId, userId, agent_assignment_id, actorUserId]
  );
}

async function assignEmployee(connection, userId, managerUserId, actorUserId) {
  const [managerRows] = await connection.execute(
    `
      SELECT
        dma.id AS manager_assignment_id,
        dma.department_id
      FROM department_manager_assignments dma
      JOIN users u ON u.id = dma.manager_user_id
      WHERE dma.manager_user_id = ?
        AND dma.end_date IS NULL
        AND u.is_active = TRUE
        AND u.deleted_at IS NULL
    `,
    [managerUserId]
  );

  if (!managerRows.length) {
    throw new Error('مدير القسم المحدد غير نشط أو غير مرتبط بقسم.');
  }

  const { manager_assignment_id, department_id } = managerRows[0];

  const [currentRows] = await connection.execute(
    `
      SELECT manager_assignment_id
      FROM employee_department_assignments
      WHERE employee_user_id = ?
        AND end_date IS NULL
    `,
    [userId]
  );

  if (currentRows[0]?.manager_assignment_id === manager_assignment_id) {
    return;
  }

  await connection.execute(
    `
      UPDATE employee_department_assignments
      SET end_date = CURDATE()
      WHERE employee_user_id = ?
        AND end_date IS NULL
    `,
    [userId]
  );

  await connection.execute(
    `
      INSERT INTO employee_department_assignments (
        employee_user_id,
        department_id,
        manager_assignment_id,
        start_date,
        created_by_user_id
      )
      VALUES (?, ?, ?, CURDATE(), ?)
    `,
    [userId, department_id, manager_assignment_id, actorUserId]
  );
}

async function applyAssignment(connection, userId, roleCode, assignment, actorUserId) {
  if (roleCode === 'COURSE_MANAGER') return;

  if (roleCode === 'AGENT') {
  const sectorName = assignment?.sectorName?.trim();

  if (!sectorName) {
    throw new Error('يجب إدخال اسم القطاع للوكيل.');
  }

  await assignAgent(
    connection,
    userId,
    sectorName,
    actorUserId
  );

  return;
}

  if (roleCode === 'DEPARTMENT_MANAGER') {
    const agentUserId = toNumber(assignment?.agentUserId);
    const departmentName = assignment?.departmentName?.trim();

    if (!agentUserId || !departmentName) {
      throw new Error('يجب اختيار الوكيل وإدخال اسم القسم.');
    }

    await assignDepartmentManager(
      connection,
      userId,
      agentUserId,
      departmentName,
      actorUserId
    );

    return;
  }

  if (roleCode === 'EMPLOYEE') {
    const managerUserId = toNumber(assignment?.managerUserId);

    if (!managerUserId) {
      throw new Error('يجب اختيار مدير القسم للموظف.');
    }

    await assignEmployee(connection, userId, managerUserId, actorUserId);
  }
}


/** دوال مساعدة لربط المستخدمين بالأقسام والقطاعات في عمليات الإدارة. */
module.exports = { bcrypt, pool, VALID_ROLES, parseRoles, toNumber, getRoleId, fetchUserById, writeAuditLog, applyAssignment };

