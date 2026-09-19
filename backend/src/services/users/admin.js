const { bcrypt, pool, VALID_ROLES, parseRoles, toNumber, getRoleId, fetchUserById, writeAuditLog, applyAssignment } = require('./admin-setup');

/** عمليات المستخدمين للإدارة؛ النطاق والصلاحية يُحددان من جلسة المستخدم. */
async function getUsers(req, res, next) {
  try {
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query.limit) || 10, 1), 100);
    const offset = (page - 1) * limit;

    const { search = '', role = '', status = '' } = req.query;

    const conditions = ['u.deleted_at IS NULL'];
    const params = [];

    if (search.trim()) {
      conditions.push(`
        (
          u.username LIKE ?
          OR up.full_name LIKE ?
          OR up.employee_number LIKE ?
        )
      `);

      const value = `%${search.trim()}%`;
      params.push(value, value, value);
    }

    if (role) {
      conditions.push(`
        EXISTS (
          SELECT 1
          FROM user_roles filter_ur
          JOIN roles filter_r ON filter_r.id = filter_ur.role_id
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

    const [countRows] = await pool.execute(
      `
        SELECT COUNT(*) AS total
        FROM users u
        LEFT JOIN user_profiles up ON up.user_id = u.id
        WHERE ${whereClause}
      `,
      params
    );

    const [rows] = await pool.execute(
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

    const total = Number(countRows[0].total);

    return res.status(200).json({
      users: rows.map((user) => ({
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
    next(error);
  }
}

async function getUserById(req, res, next) {
  try {
    const userId = toNumber(req.params.userId);

    if (!userId) {
      return res.status(400).json({ message: 'معرّف المستخدم غير صالح.' });
    }

    const user = await fetchUserById(pool, userId);

    if (!user) {
      return res.status(404).json({ message: 'المستخدم غير موجود.' });
    }

    return res.status(200).json({ user });
  } catch (error) {
    next(error);
  }
}

async function createUser(req, res, next) {
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
      !VALID_ROLES.includes(roleCode)
    ) {
      return res.status(400).json({
        message: 'بيانات المستخدم غير مكتملة أو غير صالحة.',
      });
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
      [username.trim(), passwordHash, req.user.id]
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
      [userId, fullName.trim(), employeeNumber?.trim() || null]
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
      [userId, roleId, req.user.id]
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
      [userId, req.user.id, roleCode]
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
      'USER_CREATED',
      userId,
      { username, roleCode }
    );

    await connection.commit();

    return res.status(201).json({
      message: 'تم إنشاء المستخدم بنجاح.',
      userId,
    });
  } catch (error) {
    await connection.rollback();

    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({
        message: 'اسم المستخدم أو الرقم الوظيفي مستخدم مسبقًا.',
      });
    }

    return next(error);
  } finally {
    connection.release();
  }
}

async function updateUser(req, res, next) {
  const connection = await pool.getConnection();

  try {
    const userId = toNumber(req.params.userId);

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
      !VALID_ROLES.includes(roleCode)
    ) {
      return res.status(400).json({
        message: 'بيانات المستخدم غير مكتملة أو غير صالحة.',
      });
    }

    if (newPassword && newPassword.length < 8) {
      return res.status(400).json({
        message: 'كلمة المرور الجديدة يجب أن تكون 8 أحرف على الأقل.',
      });
    }

    const currentUser = await fetchUserById(connection, userId);

    if (!currentUser) {
      return res.status(404).json({ message: 'المستخدم غير موجود.' });
    }

    if (currentUser.roles.includes('SUPER_ADMIN')) {
      return res.status(403).json({
        message: 'لا يمكن تعديل حساب Super Admin من هذه الصفحة.',
      });
    }

    await connection.beginTransaction();

    await connection.execute(
      `
        UPDATE users
        SET username = ?
        WHERE id = ?
      `,
      [username.trim(), userId]
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
      [userId, fullName.trim(), employeeNumber?.trim() || null]
    );

    if (newPassword) {
      const passwordHash = await bcrypt.hash(newPassword, 12);

      await connection.execute(
        `
          UPDATE users
          SET password_hash = ?
          WHERE id = ?
        `,
        [passwordHash, userId]
      );
    }

    const roleId = await getRoleId(connection, roleCode);

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
      [userId, roleId, req.user.id]
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
      'USER_UPDATED',
      userId,
      { username, roleCode }
    );

    await connection.commit();

    return res.status(200).json({
      message: 'تم حفظ تعديلات المستخدم بنجاح.',
    });
  } catch (error) {
    await connection.rollback();

    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({
        message: 'اسم المستخدم أو الرقم الوظيفي مستخدم مسبقًا.',
      });
    }

    return next(error);
  } finally {
    connection.release();
  }
}

async function updateUserStatus(req, res, next) {
  try {
    const userId = toNumber(req.params.userId);
    const { isActive, reason } = req.body;

    if (!userId || typeof isActive !== 'boolean') {
      return res.status(400).json({
        message: 'بيانات تغيير الحالة غير صالحة.',
      });
    }

    if (!isActive && !reason?.trim()) {
      return res.status(400).json({
        message: 'سبب إيقاف الحساب مطلوب.',
      });
    }

    if (userId === req.user.id) {
      return res.status(403).json({
        message: 'لا يمكنك إيقاف حسابك الحالي.',
      });
    }

    const user = await fetchUserById(pool, userId);

    if (!user) {
      return res.status(404).json({ message: 'المستخدم غير موجود.' });
    }

    if (user.roles.includes('SUPER_ADMIN')) {
      return res.status(403).json({
        message: 'لا يمكن تعطيل حساب Super Admin.',
      });
    }

    await pool.execute(
      `
        UPDATE users
        SET is_active = ?
        WHERE id = ?
      `,
      [isActive, userId]
    );

    // الـTrigger في قاعدة البيانات يسجل user_status_history و audit_logs.
    return res.status(200).json({
      message: isActive
        ? 'تم تفعيل الحساب بنجاح.'
        : 'تم إيقاف الحساب بنجاح.',
    });
  } catch (error) {
    next(error);
  }
}

async function softDeleteUser(req, res, next) {
  try {
    const userId = toNumber(req.params.userId);
    const { reason } = req.body;

    if (!userId || !reason?.trim()) {
      return res.status(400).json({
        message: 'سبب حذف المستخدم مطلوب.',
      });
    }

    if (userId === req.user.id) {
      return res.status(403).json({
        message: 'لا يمكنك حذف حسابك الحالي.',
      });
    }

    const user = await fetchUserById(pool, userId);

    if (!user) {
      return res.status(404).json({ message: 'المستخدم غير موجود.' });
    }

    if (user.roles.includes('SUPER_ADMIN')) {
      return res.status(403).json({
        message: 'لا يمكن حذف حساب Super Admin.',
      });
    }

    await pool.execute(
      `
        UPDATE users
        SET
          is_active = FALSE,
          deleted_at = NOW(),
          deleted_by_user_id = ?
        WHERE id = ?
      `,
      [req.user.id, userId]
    );

    await pool.execute(
      `
        INSERT INTO audit_logs (
          actor_user_id,
          event_type,
          entity_type,
          entity_id,
          after_data
        )
        VALUES (?, 'USER_SOFT_DELETED', 'users', ?, ?)
      `,
      [
        req.user.id,
        userId,
        JSON.stringify({ reason: reason.trim() }),
      ]
    );

    return res.status(200).json({
      message: 'تم حذف المستخدم منطقيًا مع الاحتفاظ بسجله التاريخي.',
    });
  } catch (error) {
    next(error);
  }
}
async function getOrganizationOptions(req, res) {
  try {
    const [agents] = await pool.query(`
      SELECT
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
      LEFT JOIN sector_agent_assignments saa
        ON saa.id = (
          SELECT MAX(saa_latest.id)
          FROM sector_agent_assignments saa_latest
          WHERE saa_latest.agent_user_id = u.id
        )
      LEFT JOIN sectors s
        ON s.id = saa.sector_id
      WHERE r.code = 'AGENT'
        AND u.is_active = 1
        AND u.deleted_at IS NULL
      ORDER BY up.full_name ASC
    `);

    const [managers] = await pool.query(`
      SELECT
        u.id,
        u.username,
        up.full_name,
        d.id AS department_id,
        d.name AS department_name,
        s.id AS sector_id,
        s.name AS sector_name,
        saa.agent_user_id,
        agent_profile.full_name AS agent_name
      FROM users u
      INNER JOIN user_profiles up
        ON up.user_id = u.id
      INNER JOIN user_roles ur
        ON ur.user_id = u.id
      INNER JOIN roles r
        ON r.id = ur.role_id
      LEFT JOIN department_manager_assignments dma
        ON dma.id = (
          SELECT MAX(dma_latest.id)
          FROM department_manager_assignments dma_latest
          WHERE dma_latest.manager_user_id = u.id
        )
      LEFT JOIN departments d
        ON d.id = dma.department_id
      LEFT JOIN sectors s
        ON s.id = d.sector_id
      LEFT JOIN sector_agent_assignments saa
        ON saa.id = (
          SELECT MAX(saa_latest.id)
          FROM sector_agent_assignments saa_latest
          WHERE saa_latest.sector_id = s.id
        )
      LEFT JOIN user_profiles agent_profile
        ON agent_profile.user_id = saa.agent_user_id
      WHERE r.code = 'DEPARTMENT_MANAGER'
        AND u.is_active = 1
        AND u.deleted_at IS NULL
      ORDER BY s.name ASC, d.name ASC, up.full_name ASC
    `);

    return res.status(200).json({
      agents,
      managers,
    });
  } catch (error) {
    console.error(
      'Organization options error:',
      error.sqlMessage || error.message
    );

    return res.status(500).json({
      message: 'تعذر تحميل خيارات التعيين الإداري من قاعدة البيانات.',
    });
  }
}

module.exports = {
  getUsers,
  getUserById,
  createUser,
  updateUser,
  updateUserStatus,
  softDeleteUser,
  getOrganizationOptions,
};

