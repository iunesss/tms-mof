const bcrypt = require('bcryptjs');
const pool = require('../../config/database');

const ALLOWED_ROLE_CODES = [
  'AGENT',
  'DEPARTMENT_MANAGER',
  'EMPLOYEE',
];

function sendError(res, status, message) {
  return res.status(status).json({ message });
}

function toPositiveInteger(value) {
  const number = Number(value);

  return Number.isInteger(number) && number > 0 ? number : null;
}

function parseRoles(rolesText) {
  return rolesText
    ? rolesText.split(',').filter(Boolean)
    : [];
}

function createDepartmentCode() {
  return `DEPT-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

function createSectorCode() {
  return `SECTOR-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

function hasForbiddenRole(roles = []) {
  return roles.some(
    (role) =>
      role === 'SUPER_ADMIN' ||
      role === 'COURSE_MANAGER'
  );
}

async function getRoleId(connection, roleCode) {
  const [rows] = await connection.execute(
    `
      SELECT id
      FROM roles
      WHERE code = ?
      LIMIT 1
    `,
    [roleCode]
  );

  return rows[0]?.id || null;
}

async function writeAuditLog(
  connection,
  actorUserId,
  eventType,
  entityId,
  afterData = null
) {
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
      afterData ? JSON.stringify(afterData) : null,
    ]
  );
}

async function fetchAllowedUserById(connection, userId) {
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

  if (!rows.length) {
    return null;
  }

  const user = {
    ...rows[0],
    roles: parseRoles(rows[0].roles_text),
  };

  /*
    يمنع تمامًا الوصول إلى:
    Super Admin و Course Manager،
    حتى لو كتب شخص رابط المستخدم يدويًا.
  */
  if (
    !user.roles.some((role) => ALLOWED_ROLE_CODES.includes(role)) ||
    hasForbiddenRole(user.roles)
  ) {
    return null;
  }

  return user;
}

async function assignAgent(
  connection,
  userId,
  sectorName,
  actorUserId
) {
  const normalizedSectorName = String(sectorName || '').trim();

  if (!normalizedSectorName) {
    throw new Error('يجب إدخال اسم القطاع للوكيل.');
  }

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

  if (!sectorId) {
    const [result] = await connection.execute(
      `
        INSERT INTO sectors (
          code,
          name
        )
        VALUES (?, ?)
      `,
      [createSectorCode(), normalizedSectorName]
    );

    sectorId = result.insertId;
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

  if (Number(currentRows[0]?.sector_id) === Number(sectorId)) {
    return;
  }

  await connection.execute(
    `
      UPDATE sector_agent_assignments
      SET end_date = CURDATE()
      WHERE agent_user_id = ?
        AND end_date IS NULL
    `,
    [userId]
  );

  /*
    لكل قطاع وكيل نشط واحد فقط.
  */
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
  const normalizedAgentUserId = toPositiveInteger(agentUserId);
  const normalizedDepartmentName = String(departmentName || '').trim();

  if (!normalizedAgentUserId || !normalizedDepartmentName) {
    throw new Error('يجب اختيار الوكيل وإدخال اسم القسم.');
  }

  const [agentRows] = await connection.execute(
    `
      SELECT
        saa.id AS agent_assignment_id,
        saa.sector_id
      FROM sector_agent_assignments saa
      INNER JOIN users u
        ON u.id = saa.agent_user_id
      INNER JOIN user_roles ur
        ON ur.user_id = u.id
      INNER JOIN roles r
        ON r.id = ur.role_id
        AND r.code = 'AGENT'
      WHERE saa.agent_user_id = ?
        AND saa.end_date IS NULL
        AND u.is_active = TRUE
        AND u.deleted_at IS NULL
      LIMIT 1
    `,
    [normalizedAgentUserId]
  );

  if (!agentRows.length) {
    throw new Error('الوكيل المحدد غير نشط أو غير مرتبط بقطاع.');
  }

  const {
    agent_assignment_id: agentAssignmentId,
    sector_id: sectorId,
  } = agentRows[0];

  const [departmentRows] = await connection.execute(
    `
      SELECT id
      FROM departments
      WHERE sector_id = ?
        AND name = ?
        AND deleted_at IS NULL
      LIMIT 1
    `,
    [sectorId, normalizedDepartmentName]
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
      [
        sectorId,
        createDepartmentCode(),
        normalizedDepartmentName,
      ]
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
    Number(currentRows[0]?.department_id) === Number(departmentId) &&
    Number(currentRows[0]?.agent_assignment_id) ===
      Number(agentAssignmentId)
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

  /*
    القسم له مدير نشط واحد.
  */
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
    [
      departmentId,
      userId,
      agentAssignmentId,
      actorUserId,
    ]
  );
}

async function assignEmployee(
  connection,
  userId,
  managerUserId,
  actorUserId
) {
  const normalizedManagerUserId = toPositiveInteger(managerUserId);

  if (!normalizedManagerUserId) {
    throw new Error('يجب اختيار مدير القسم للموظف.');
  }

  const [managerRows] = await connection.execute(
    `
      SELECT
        dma.id AS manager_assignment_id,
        dma.department_id
      FROM department_manager_assignments dma
      INNER JOIN users u
        ON u.id = dma.manager_user_id
      INNER JOIN user_roles ur
        ON ur.user_id = u.id
      INNER JOIN roles r
        ON r.id = ur.role_id
        AND r.code = 'DEPARTMENT_MANAGER'
      WHERE dma.manager_user_id = ?
        AND dma.end_date IS NULL
        AND u.is_active = TRUE
        AND u.deleted_at IS NULL
      LIMIT 1
    `,
    [normalizedManagerUserId]
  );

  if (!managerRows.length) {
    throw new Error('مدير القسم المحدد غير نشط أو غير مرتبط بقسم.');
  }

  const {
    manager_assignment_id: managerAssignmentId,
    department_id: departmentId,
  } = managerRows[0];

  const [currentRows] = await connection.execute(
    `
      SELECT manager_assignment_id
      FROM employee_department_assignments
      WHERE employee_user_id = ?
        AND end_date IS NULL
    `,
    [userId]
  );

  if (
    Number(currentRows[0]?.manager_assignment_id) ===
    Number(managerAssignmentId)
  ) {
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
    [
      userId,
      departmentId,
      managerAssignmentId,
      actorUserId,
    ]
  );
}

async function applyAssignment(
  connection,
  userId,
  roleCode,
  assignment,
  actorUserId
) {
  if (roleCode === 'AGENT') {
    await assignAgent(
      connection,
      userId,
      assignment?.sectorName,
      actorUserId
    );

    return;
  }

  if (roleCode === 'DEPARTMENT_MANAGER') {
    await assignDepartmentManager(
      connection,
      userId,
      assignment?.agentUserId,
      assignment?.departmentName,
      actorUserId
    );

    return;
  }

  if (roleCode === 'EMPLOYEE') {
    await assignEmployee(
      connection,
      userId,
      assignment?.managerUserId,
      actorUserId
    );
  }
}


/** دوال مساعدة لربط المستخدمين ضمن صلاحيات مدير الدورة. */
module.exports = { bcrypt, pool, ALLOWED_ROLE_CODES, sendError, parseRoles, toPositiveInteger, getRoleId, fetchAllowedUserById, writeAuditLog, applyAssignment };

