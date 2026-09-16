const bcrypt = require('bcryptjs');
const pool = require('../config/database');

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

async function getUsers(req, res) {
  try {
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(
      Math.max(Number(req.query.limit) || 10, 1),
      100
    );

    const offset = (page - 1) * limit;

    const search = String(req.query.search || '').trim();
    const role = String(req.query.role || '').trim();
    const status = String(req.query.status || '').trim();

    if (role && !ALLOWED_ROLE_CODES.includes(role)) {
      return sendError(res, 400, 'الدور المحدد غير مسموح.');
    }

    const conditions = [
      'u.deleted_at IS NULL',
      `
        EXISTS (
          SELECT 1
          FROM user_roles visible_ur
          INNER JOIN roles visible_r
            ON visible_r.id = visible_ur.role_id
          WHERE visible_ur.user_id = u.id
            AND visible_r.code IN (
              'AGENT',
              'DEPARTMENT_MANAGER',
              'EMPLOYEE'
            )
        )
      `,
      `
        NOT EXISTS (
          SELECT 1
          FROM user_roles hidden_ur
          INNER JOIN roles hidden_r
            ON hidden_r.id = hidden_ur.role_id
          WHERE hidden_ur.user_id = u.id
            AND hidden_r.code IN (
              'SUPER_ADMIN',
              'COURSE_MANAGER'
            )
        )
      `,
    ];

    const params = [];

    if (search) {
      conditions.push(`
        (
          u.username LIKE ?
          OR up.full_name LIKE ?
          OR up.employee_number LIKE ?
        )
      `);

      const value = `%${search}%`;
      params.push(value, value, value);
    }

    if (role) {
      conditions.push(`
        EXISTS (
          SELECT 1
          FROM user_roles filter_ur
          INNER JOIN roles filter_r
            ON filter_r.id = filter_ur.role_id
          WHERE filter_ur.user_id = u.id
            AND filter_r.code = ?
        )
      `);

      params.push(role);
    }

    if (status === 'active') {
      conditions.push('u.is_active = TRUE');
    }

    if (status === 'inactive') {
      conditions.push('u.is_active = FALSE');
    }

    const whereClause = conditions.join(' AND ');

    const [countRows] = await pool.query(
      `
        SELECT COUNT(*) AS total
        FROM users u
        LEFT JOIN user_profiles up
          ON up.user_id = u.id
        WHERE ${whereClause}
      `,
      params
    );

    const [users] = await pool.query(
      `
        SELECT
          u.id,
          u.username,
          u.is_active,
          up.full_name,
          up.employee_number,

          GROUP_CONCAT(DISTINCT r.code ORDER BY r.code) AS roles_text,

          MAX(agent_sector.name) AS sector_name,
          MAX(manager_department.name) AS department_name,
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

        LEFT JOIN employee_department_assignments employee_assignment
          ON employee_assignment.employee_user_id = u.id
          AND employee_assignment.end_date IS NULL

        LEFT JOIN department_manager_assignments employee_manager
          ON employee_manager.id = employee_assignment.manager_assignment_id

        LEFT JOIN user_profiles employee_manager_profile
          ON employee_manager_profile.user_id = employee_manager.manager_user_id

        WHERE ${whereClause}

        GROUP BY
          u.id,
          u.username,
          u.is_active,
          up.full_name,
          up.employee_number

        ORDER BY u.created_at DESC
        LIMIT ? OFFSET ?
      `,
      [...params, limit, offset]
    );

    const total = Number(countRows[0]?.total || 0);

    return res.json({
      users: users.map((user) => ({
        ...user,
        roles: parseRoles(user.roles_text),
      })),

      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(Math.ceil(total / limit), 1),
      },
    });
  } catch (error) {
    console.error('Course manager list users error:', error);
    return sendError(res, 500, 'تعذر تحميل المستخدمين.');
  }
}

async function getUserById(req, res) {
  try {
    const userId = toPositiveInteger(req.params.userId);

    if (!userId) {
      return sendError(res, 400, 'معرّف المستخدم غير صالح.');
    }

    const user = await fetchAllowedUserById(pool, userId);

    if (!user) {
      return sendError(
        res,
        404,
        'المستخدم غير موجود أو ليس ضمن صلاحياتك.'
      );
    }

    return res.json({ user });
  } catch (error) {
    console.error('Course manager get user error:', error);
    return sendError(res, 500, 'تعذر تحميل بيانات المستخدم.');
  }
}

async function getOrganizationOptions(req, res) {
  try {
    const [agents] = await pool.query(`
      SELECT DISTINCT
        u.id,
        u.username,
        up.full_name,
        s.id AS sector_id,
        s.name AS sector_name
      FROM users u
      INNER JOIN user_profiles up
        ON up.user_id = u.id
      INNER JOIN user_roles ur
        ON ur.user_id = u.id
      INNER JOIN roles r
        ON r.id = ur.role_id
        AND r.code = 'AGENT'
      LEFT JOIN sector_agent_assignments saa
        ON saa.agent_user_id = u.id
        AND saa.end_date IS NULL
      LEFT JOIN sectors s
        ON s.id = saa.sector_id
      WHERE u.is_active = TRUE
        AND u.deleted_at IS NULL
      ORDER BY up.full_name ASC
    `);

    const [managers] = await pool.query(`
      SELECT DISTINCT
        u.id,
        u.username,
        up.full_name,
        d.id AS department_id,
        d.name AS department_name,
        s.id AS sector_id,
        s.name AS sector_name
      FROM users u
      INNER JOIN user_profiles up
        ON up.user_id = u.id
      INNER JOIN user_roles ur
        ON ur.user_id = u.id
      INNER JOIN roles r
        ON r.id = ur.role_id
        AND r.code = 'DEPARTMENT_MANAGER'
      LEFT JOIN department_manager_assignments dma
        ON dma.manager_user_id = u.id
        AND dma.end_date IS NULL
      LEFT JOIN departments d
        ON d.id = dma.department_id
      LEFT JOIN sectors s
        ON s.id = d.sector_id
      WHERE u.is_active = TRUE
        AND u.deleted_at IS NULL
      ORDER BY s.name ASC, d.name ASC, up.full_name ASC
    `);

    return res.json({
      agents,
      managers,
    });
  } catch (error) {
    console.error('Course manager organization options error:', error);

    return sendError(
      res,
      500,
      'تعذر تحميل خيارات التعيين الإداري.'
    );
  }
}

async function createUser(req, res) {
  const connection = await pool.getConnection();

  try {
    const {
      username,
      password,
      roleCode,
      fullName,
      employeeNumber,
      assignment,
    } = req.body;

    if (
      !username?.trim() ||
      !password ||
      password.length < 8 ||
      !fullName?.trim() ||
      !ALLOWED_ROLE_CODES.includes(roleCode)
    ) {
      return sendError(res, 400, 'بيانات المستخدم غير مكتملة أو غير صالحة.');
    }

    await connection.beginTransaction();

    const roleId = await getRoleId(connection, roleCode);

    if (!roleId) {
      throw new Error('الدور المحدد غير موجود.');
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const [userResult] = await connection.execute(
      `
        INSERT INTO users (
          username,
          password_hash,
          is_active,
          created_by_user_id
        )
        VALUES (?, ?, TRUE, ?)
      `,
      [
        username.trim(),
        passwordHash,
        req.user.id,
      ]
    );

    const userId = userResult.insertId;

    await connection.execute(
      `
        INSERT INTO user_profiles (
          user_id,
          full_name,
          employee_number
        )
        VALUES (?, ?, ?)
      `,
      [
        userId,
        fullName.trim(),
        employeeNumber?.trim() || null,
      ]
    );

    await connection.execute(
      `
        INSERT INTO user_roles (
          user_id,
          role_id,
          assigned_by_user_id
        )
        VALUES (?, ?, ?)
      `,
      [
        userId,
        roleId,
        req.user.id,
      ]
    );

    await connection.execute(
      `
        INSERT INTO user_creation_history (
          created_user_id,
          creator_user_id,
          role_at_creation
        )
        VALUES (?, ?, ?)
      `,
      [
        userId,
        req.user.id,
        roleCode,
      ]
    );

    await applyAssignment(
      connection,
      userId,
      roleCode,
      assignment,
      req.user.id
    );

    await writeAuditLog(
      connection,
      req.user.id,
      'COURSE_MANAGER_USER_CREATED',
      userId,
      {
        username: username.trim(),
        roleCode,
      }
    );

    await connection.commit();

    return res.status(201).json({
      message: 'تم إنشاء المستخدم بنجاح.',
      userId,
    });
  } catch (error) {
    await connection.rollback();

    if (error.code === 'ER_DUP_ENTRY') {
      return sendError(
        res,
        409,
        'اسم المستخدم أو الرقم الوظيفي مستخدم مسبقًا.'
      );
    }

    console.error('Course manager create user error:', error);
    return sendError(
      res,
      400,
      error.message || 'تعذر إنشاء المستخدم.'
    );
  } finally {
    connection.release();
  }
}

async function updateUser(req, res) {
  const connection = await pool.getConnection();

  try {
    const userId = toPositiveInteger(req.params.userId);

    const {
      username,
      roleCode,
      fullName,
      employeeNumber,
      newPassword,
      assignment,
    } = req.body;

    if (
      !userId ||
      !username?.trim() ||
      !fullName?.trim() ||
      !ALLOWED_ROLE_CODES.includes(roleCode)
    ) {
      return sendError(res, 400, 'بيانات المستخدم غير مكتملة أو غير صالحة.');
    }

    if (newPassword && newPassword.length < 8) {
      return sendError(
        res,
        400,
        'كلمة المرور الجديدة يجب أن تكون 8 أحرف على الأقل.'
      );
    }

    const currentUser = await fetchAllowedUserById(connection, userId);

    if (!currentUser) {
      return sendError(
        res,
        404,
        'المستخدم غير موجود أو ليس ضمن صلاحياتك.'
      );
    }

    await connection.beginTransaction();

    await connection.execute(
      `
        UPDATE users
        SET username = ?
        WHERE id = ?
      `,
      [
        username.trim(),
        userId,
      ]
    );

    await connection.execute(
      `
        INSERT INTO user_profiles (
          user_id,
          full_name,
          employee_number
        )
        VALUES (?, ?, ?)
        ON DUPLICATE KEY UPDATE
          full_name = VALUES(full_name),
          employee_number = VALUES(employee_number)
      `,
      [
        userId,
        fullName.trim(),
        employeeNumber?.trim() || null,
      ]
    );

    if (newPassword) {
      const passwordHash = await bcrypt.hash(newPassword, 12);

      await connection.execute(
        `
          UPDATE users
          SET password_hash = ?
          WHERE id = ?
        `,
        [
          passwordHash,
          userId,
        ]
      );
    }

    const roleId = await getRoleId(connection, roleCode);

    if (!roleId) {
      throw new Error('الدور المحدد غير موجود.');
    }

    await connection.execute(
      'DELETE FROM user_roles WHERE user_id = ?',
      [userId]
    );

    await connection.execute(
      `
        INSERT INTO user_roles (
          user_id,
          role_id,
          assigned_by_user_id
        )
        VALUES (?, ?, ?)
      `,
      [
        userId,
        roleId,
        req.user.id,
      ]
    );

    await applyAssignment(
      connection,
      userId,
      roleCode,
      assignment,
      req.user.id
    );

    await writeAuditLog(
      connection,
      req.user.id,
      'COURSE_MANAGER_USER_UPDATED',
      userId,
      {
        username: username.trim(),
        roleCode,
      }
    );

    await connection.commit();

    return res.json({
      message: 'تم حفظ تعديلات المستخدم بنجاح.',
    });
  } catch (error) {
    await connection.rollback();

    if (error.code === 'ER_DUP_ENTRY') {
      return sendError(
        res,
        409,
        'اسم المستخدم أو الرقم الوظيفي مستخدم مسبقًا.'
      );
    }

    console.error('Course manager update user error:', error);

    return sendError(
      res,
      400,
      error.message || 'تعذر حفظ تعديلات المستخدم.'
    );
  } finally {
    connection.release();
  }
}

async function updateUserStatus(req, res) {
  try {
    const userId = toPositiveInteger(req.params.userId);
    const { isActive, reason } = req.body;

    if (!userId || typeof isActive !== 'boolean') {
      return sendError(res, 400, 'بيانات تغيير الحالة غير صالحة.');
    }

    if (!isActive && !reason?.trim()) {
      return sendError(res, 400, 'سبب إيقاف الحساب مطلوب.');
    }

    const user = await fetchAllowedUserById(pool, userId);

    if (!user) {
      return sendError(
        res,
        404,
        'المستخدم غير موجود أو ليس ضمن صلاحياتك.'
      );
    }

    await pool.execute(
      `
        UPDATE users
        SET is_active = ?
        WHERE id = ?
      `,
      [
        isActive,
        userId,
      ]
    );

    await writeAuditLog(
      pool,
      req.user.id,
      'COURSE_MANAGER_USER_STATUS_CHANGED',
      userId,
      {
        isActive,
        reason: reason?.trim() || null,
      }
    );

    return res.json({
      message: isActive
        ? 'تم تنشيط الحساب بنجاح.'
        : 'تم إيقاف الحساب بنجاح.',
    });
  } catch (error) {
    console.error('Course manager update user status error:', error);

    return sendError(
      res,
      500,
      'تعذر تحديث حالة المستخدم.'
    );
  }
}

module.exports = {
  getUsers,
  getUserById,
  getOrganizationOptions,
  createUser,
  updateUser,
  updateUserStatus,
};